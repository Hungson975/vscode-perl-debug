import {join} from 'path';
import {spawn} from 'child_process';
import {StreamCatcher} from './streamCatcher';
import * as RX from './regExp';
import variableParser, { ParsedVariable, ParsedVariableScope } from './variableParser';

interface ResponseError {
	filename: string,
	ln: number,
	message: string,
	near: string,
	type: string,
}

interface Variable {
	name: string,
	type: string,
	value: any,
	variablesReference: number,
}

interface LaunchOptions {
	exec?: string;
}

export interface RequestResponse {
	data?: string[],
	orgData: string[],
	ln: number,
	errors: ResponseError[],
	name: string,
	filename: string,
	exception: boolean,
	finished: boolean,
	command?:string,
	db?:string,
}

function findFilenameLine(str: string): string[] {
	// main::(test.pl:8):
	const fileMatch = str.match(RX.fileMatch);
	// at test.pl line 10
	const fileMatchException = str.match(RX.fileMatchException);

	return fileMatch || fileMatchException || [];
}

function variableType(key: string, val: string): string {
	if (/^['|"]/.test(val)) {
		return 'string';
	}
	if (/^([0-9\,\.]+)$/) {
		return 'integer';
	}

	return 'Unknown';
}

function variableValue(val: string): any {
	if (/^['|"]/.test(val)) {
		return val.replace(/^'/, '').replace(/'$/, '');
	}
	if (/^([0-9\,\.]+)$/) {
		return +val;
	}

	return val;
}

export class perlDebuggerConnection {
	public debug: boolean = false;
	private perlDebugger;
	public streamCatcher: StreamCatcher;
	public perlVersion: string;

	private filename?: string;
	private filepath?: string;
	private currentfile?: string;

	public onOutput: Function | null = null;
	public onError: Function | null = null;
	public onClose: Function | null = null;
	public onException: Function | null = null;
	public onTermination: Function | null = null;

	/**
	 * Pass in the initial script and optional additional arguments for
	 * running the script.
	 */
	constructor() {
		this.streamCatcher = new StreamCatcher();
	}

	async initializeRequest() {}

	logOutput(data: string) {
		if (typeof this.onOutput === 'function') {
			try {
				this.onOutput(data);
			} catch (err) {
				throw new Error(`Error in "onOutput" handler: ${err.message}`);
			}
		}
	}

	logData(prefix: string, data: string[]) {
		data.forEach((val, i) => {
			this.logOutput(`${prefix}${val}`);
		});
	}

	parseResponse(data: string[]): RequestResponse {
		const res = {
			data: [],
			orgData: data,
			ln: 0,
			errors: [],
			name: '',
			filename: '',
			exception: false,
			finished: false,
			command: '',
			db: '',
		};

		res.orgData.forEach((line, i) => {
			if (i === 0) {
				// Command line
				res.command = line;
			} else if (i === res.orgData.length - 1) {
				// DB
				const dbX = RX.lastCommandLine.match(line);
				if (dbX) res.db = dbX[1];
			} else {
				// Contents
				line = line.replace(RX.colors, '');
				if (!RX.isGarbageLine(line)) {
					res.data.push(line);
				}

				// Grap the last filename and line number
				const [, filename, ln] = findFilenameLine(line);
				if (filename) {
					res.name = filename;
					res.filename = join(this.filepath, filename);
					res.ln = +ln;
				}

				// Check contents for issues
				if (/^exception/.test(line)) {
					// xxx: investigate if this is already handled
				//	res.exception = true;
				}

				if (/^Debugged program terminated/.test(line)) {
					res.finished = true;
				}

				if (/Use 'q' to quit or 'R' to restart\./.test(line)) {
					res.finished = true;
				}

				if (/^Execution of (\S+) aborted due to compilation errors\.$/.test(line)) {
					res.exception = true;
				}

				if (RX.codeErrorSyntax.test(line)) {
					const parts = line.match(RX.codeErrorSyntax);
					if (parts) {
						res.errors.push({
							name: parts[1],
							filename: join(this.filepath, parts[1]),
							ln: +parts[2],
							message: line,
							near: parts[3],
							type: 'SYNTAX',
						});
					}
				}

				// Undefined subroutine &main::functionNotFound called at broken_code.pl line 10.
				if (RX.codeErrorRuntime.test(line)) {
					res.exception = true;
					const parts = line.match(RX.codeErrorRuntime);
					if (parts) {
						res.errors.push({
							name: parts[2],
							filename: join(this.filepath, parts[2]),
							ln: +parts[3],
							message: line,
							near: parts[1],
							type: 'RUNTIME',
						});
					}
				}

			}
		});

		if (res.exception) {
			if (typeof this.onException === 'function') {
				try {
					this.onException(res)
				} catch (err) {
					throw new Error(`Error in "onException" handler: ${err.message}`);
				}
			}
		}
		if (res.finished) {
			if (typeof this.onTermination === 'function') {
				try {
					this.onTermination(res)
				} catch (err) {
					throw new Error(`Error in "onTermination" handler: ${err.message}`);
				}
			}
		}

		if (this.debug) console.log(res);

		if (res.exception) {
			throw res;
		}

		return res;
	}

	async launchRequest(filename: string, filepath: string, args: string[] = [], options:LaunchOptions = {}): Promise<RequestResponse> {
		this.filename = filename;
		this.filepath = filepath;
		this.currentfile = filename;
		const sourceFile = join(filepath, filename);

		if (this.debug) console.log(`Launch "perl -d ${sourceFile}" in "${filepath}"`);

		const perlCommand = options.exec || 'perl';

		const commandArgs = [].concat(args, [ '-d', filename]);
		this.logOutput( `${perlCommand} ${commandArgs.join(' ')}`);

		// xxx: add failure handling
		this.perlDebugger = spawn(perlCommand, commandArgs, {
			detached: true,
			cwd: filepath,
		});

		this.perlDebugger.on('error', (err) => {
			if (this.debug) console.log('error:', err);
			this.logOutput( `Error`);
			this.logOutput( err );
		});

		this.streamCatcher.launch(this.perlDebugger.stdin, this.perlDebugger.stderr);

		// this.streamCatcher.debug = this.debug;

		// Handle program output
		this.perlDebugger.stdout.on('data', (buffer) => {
			const data = buffer.toString().split('\n');
			this.logData('', data); // xxx: Program output, better formatting/colors?
		});

		this.perlDebugger.on('close', (code) => {
			if (this.streamCatcher.ready) {
				this.logOutput(`Debugger connection closed`);
			} else {
				this.logOutput(`Could not connect to debugger, connection closed`);
			}
			if (typeof this.onClose === 'function') {
				try {
					this.onClose(code);
				} catch (err) {
					throw new Error(`Error in "onClose" handler: ${err.message}`);
				}
			}
		});

		// Depend on the data dumper for the watcher
		// await this.streamCatcher.request('use Data::Dumper');
		const result = await this.streamCatcher.isReady();
		this.logData('', result.slice(0, result.length-2));

		this.perlVersion = await this.getPerlVersion();
		// Listen for a ready signal
		return this.parseResponse(result);
	}

	async request(command: string): Promise<RequestResponse> {
		await this.streamCatcher.isReady();
		return this.parseResponse(await this.streamCatcher.request(command));
	}

	async relativePath(filename: string) {
		await this.streamCatcher.isReady();
		return filename && filename.replace(`${this.filepath}/`, '');
	}

	async setFileContext(filename: string = this.filename) {
		// await this.request(`print STDERR "${filename}"`);
		const res = await this.request(`f ${filename}`);
		if (res.data.length) {
			// if (/Already in/.test)
			if (/^No file matching/.test(res.data[0])) {
				throw new Error(res.data[0]);
			}
		}
		this.currentfile = filename;
		return res;
	}

	async setBreakPoint(ln: number, filename?: string): Promise<RequestResponse> {
		// xxx: We call `b ${filename}:${ln}` but this will not complain
		// about files not found - this might be ok for now
		// await this.setFileContext(filename);
		// const command = filename ? `b ${filename}:${ln}` : `b ${ln}`;
		// const res = await this.request(`b ${ln}`);

		return Promise.all([this.setFileContext(filename), this.request(`b ${ln}`)])
			.then(result => {
				const res = <RequestResponse>result.pop();
				if (this.debug) console.log(res);
				if (res.data.length) {
					if (/not breakable\.$/.test(res.data[0])) {
						throw new Error(res.data[0] + ' ' + filename + ':' + ln);
					}
					if (/not found\.$/.test(res.data[0])) {
						throw new Error(res.data[0] + ' ' + filename + ':' + ln);
					}
				}
				return res;
			});
	}

	async getBreakPoints() {
		const res = await this.request(`L b`);
		const breakpoints = {};
		if (this.debug) console.log(res);
		let currentFile = 'unknown';
		res.data.forEach(line => {
			if (RX.breakPoint.condition.test(line)) {
				// Not relevant
			} else if (RX.breakPoint.ln.test(line)) {
				const lnX = line.match(RX.breakPoint.ln);
				if (breakpoints[currentFile] && lnX) {
					const ln = +lnX[1];
					if (lnX[1] === `${ln}`) {
						breakpoints[currentFile].push(ln);
					}
				}
			} else if (RX.breakPoint.filename.test(line)) {
				currentFile = line.replace(/:$/, '');
				if (this.debug) console.log('GOT FILENAME:', currentFile);
				if (typeof breakpoints[currentFile] === 'undefined') {
					breakpoints[currentFile] = [];
				}
			} else {
				// Dunno
			}
		});

		if (this.debug) console.log('BREAKPOINTS:', breakpoints);
		return breakpoints;
	}

	clearBreakPoint(ln: number, filename?: string): Promise<RequestResponse> {
		// xxx: We call `B ${filename}:${ln}` but this will not complain
		// about files not found - not sure if it's a bug or not but
		// the perl debugger will change the main filename to filenames
		// not found - a bit odd
		// await this.setFileContext(filename);
		// const command = filename ? `B ${filename}:${ln}` : `B ${ln}`;
		return Promise.all([this.setFileContext(filename), this.request(`B ${ln}`)])
			.then(results => <RequestResponse>results.pop());
	}

	async clearAllBreakPoints() {
		return await this.request('B *');
	}

	async continue() {
		return await this.request('c');
	}
// Next:
	async next() {
		return await this.request('n');
	}

	async restart() {
		return await this.request('R');
	}

	async getVariableReference(name: string): Promise<string> {
		const res = await this.request(`print STDERR \\${name}`);
		return res.data[0];
	}

	async getExpressionValue(expression: string): Promise<string> {
		const res = await this.request(`print STDERR ${expression}`);
		return res.data.pop();
	}

	/**
	 * Prints out a nice indent formatted list of variables with
	 * array references resolved.
	 */
	async requestVariableOutput(level: number) {
		const variables: Variable[] = [];
		const fixLevel = this.perlVersion >= '5.022000';
		const res = await this.request(`y ${fixLevel ? level-1 : level}`);
		const result = [];

		if (/^Not nested deeply enough/.test(res.data[0])) {
			return [];
		}

		if (RX.codeErrorMissingModule.test(res.data[0])) {
			throw new Error(res.data[0]);
		}

		// Resolve all Array references
		for (let i = 0; i < res.data.length; i++) {
			const line = res.data[i];
			if (/\($/.test(line)) {
				const name = line.split(' = ')[0];
				const reference = await this.getVariableReference(name);
				result.push(`${name} = ${reference}`);
			} else if (line !== ')') {
				result.push(line);
			}
		}

		return result;
	}

	async getVariableList(level: number, scopeName?: string): Promise<ParsedVariableScope> {
		const variableOutput = await this.requestVariableOutput(level);
		//console.log('RESOLVED:');
		//console.log(variableOutput);
		return variableParser(variableOutput, scopeName);
	}

	async variableList(scopes): Promise<ParsedVariableScope> {
		const keys = Object.keys(scopes);
		let result: ParsedVariableScope = {};

		for (let i = 0; i < keys.length; i++) {
			const name = keys[i];
			const level = scopes[name];
			Object.assign(result, await this.getVariableList(level, name));
		}
		return result;
	}

	async getStackTrace() {
		const res = await this.request('T');
		const result = [];

		res.data.forEach((line, i) => {
			// > @ = DB::DB called from file 'lib/Module2.pm' line 5
			// > . = Module2::test2() called from file 'test.pl' line 12
			const m = line.match(/^(\S+) = (\S+) called from file \'(\S+)\' line ([0-9]+)$/);

			if (m !== null) {
				const [, v, caller, name, ln] = m;
				const filename = join(this.filepath, name);
				result.push({
					v,
					name,
					filename,
					caller,
					ln: +ln,
				});
			}

		});

		return result;
	}

	async watchExpression(expression) {
		// Brute force this a bit...
		return Promise.all([
			this.request(`W ${expression}`),
			this.request(`w ${expression}`),
		])
		.then(res => res.pop());
	}

	async clearAllWatchers() {
		return this.request('W *');
	}

	async getPerlVersion(): Promise<string> {
		const res = await this.request('p $]');
		return res.data[0];
	}

	async destroy() {
		if (this.perlDebugger) {
			this.streamCatcher.destroy();
			this.perlDebugger.kill();
			this.perlDebugger = null;
		}
	}
}