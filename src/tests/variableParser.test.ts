import assert = require('assert');
import asyncAssert from './asyncAssert';
import * as Path from 'path';
import variableParser, { resolveVariable } from '../variableParser';

const data = [ '$bar = \'bar\'',
  '$hello = HASH(0x7fd2689527f0)',
  '   \'bar\' => 12',
  '   \'foo\' => \'bar\'',
  '   \'really\' => \'true\'',
  '$i = 12',
  '$obj = HASH(0x7fd26896ecb0)',
  '   8 => \'-9\'',
  '   \'bar\' => HASH(0x7fd2689527f0)',
  '      \'bar\' => 12',
  '      \'foo\' => \'bar\'',
  '      \'really\' => \'true\'',
  '   \'foo\' => \'bar\'',
  '   \'list\' => ARRAY(0x7fd269242a50)',
  '      0  \'a\'',
  '      1  \'\\\'b\'',
  '      2  \'c\'',
  '   \'ownObj\' => HASH(0x7fd26892c6c0)',
  '      \'ownFoo\' => \'own?\'',
  '   \'ownlist\' => 7',
  '@list1 = ARRAY(0x7fd269242a50)',
  '   0  \'a\'',
  '   1  \'\\\'b\'',
  '   2  \'c\'',
  '@list2 = ARRAY(0x7fd269242a68)',
  '   0  1',
  '   1  2',
  '   2  3',
  '@list3 = ARRAY(0x7fd269242b10)',
  '   0  \'a\'',
  '   1  \'\\\'b\'',
  '   2  \'c\'',
  '   3  1',
  '   4  2',
  '   5  3'
];

const dataFaulty = [ '$bar = \'bar\'',
  '$hello = HASH(0x7fd2689527f0)',
  '   \'bar\' => 12',
  '   \'foo\' => ',
  '\'bar\'',
  '   \'really\' => \'true\'',
  '$i = 12',
  '$obj = ',
  'HASH(0x7fd26896ecb0)',
  '   8 => \'-9\'',
  '   \'bar\' => HASH(0x7fd2689527f0)',
  '      \'bar\' => 12',
  '      \'foo\' => ',
  '\'bar\'',
  '      \'really\' => \'true\'',
  '   \'foo\' => \'bar\'',
  '   \'list\' => ',
  'ARRAY(0x7fd269242a50)',
  '      0  \'a\'',
  '      1  ',
  '\'\\\'b\'',
  '      2  \'c\'',
  '   \'ownObj\' => ',
  'HASH(0x7fd26892c6c0)',
  '      \'ownFoo\' => \'own?\'',
  '   \'ownlist\' => 7',
  '@list1 = ARRAY(0x7fd269242a50)',
  '   0  \'a\'',
  '   1  \'\\\'b\'',
  '   2  \'c\'',
  '@list2 = ARRAY(0x7fd269242a68)',
  '   0  1',
  '   1  2',
  '   2  3',
  '@list3 = ARRAY(0x7fd269242b10)',
  '   0  \'a\'',
  '   1  \'\\\'b\'',
  '   2  \'c\'',
  '   3  1',
  '   4  2',
  '   5  3'
];

const expectedResult = {
    'local_0':
        [ { name: '$bar',
        value: 'bar',
        type: 'string',
        variablesReference: '0' },
        { name: '$hello',
        value: 'HASH(0x7fd2689527f0)',
        type: 'object',
        variablesReference: 'HASH(0x7fd2689527f0)' },
        { name: '$i',
        value: '12',
        type: 'integer',
        variablesReference: '0' },
        { name: '$obj',
        value: 'HASH(0x7fd26896ecb0)',
        type: 'object',
        variablesReference: 'HASH(0x7fd26896ecb0)' },
        { name: '@list1',
        value: 'ARRAY(0x7fd269242a50)',
        type: 'array',
        variablesReference: 'ARRAY(0x7fd269242a50)' },
        { name: '@list2',
        value: 'ARRAY(0x7fd269242a68)',
        type: 'array',
        variablesReference: 'ARRAY(0x7fd269242a68)' },
        { name: '@list3',
        value: 'ARRAY(0x7fd269242b10)',
        type: 'array',
        variablesReference: 'ARRAY(0x7fd269242b10)' } ],
    'HASH(0x7fd2689527f0)':
        [ { name: 'bar',
        value: '12',
        type: 'integer',
        variablesReference: '0' },
        { name: 'foo',
        value: 'bar',
        type: 'string',
        variablesReference: '0' },
        { name: 'really',
        value: 'true',
        type: 'boolean',
        variablesReference: '0' },
        { name: 'bar',
        value: '12',
        type: 'integer',
        variablesReference: '0' },
        { name: 'foo',
        value: 'bar',
        type: 'string',
        variablesReference: '0' },
        { name: 'really',
        value: 'true',
        type: 'boolean',
        variablesReference: '0' } ],
    'HASH(0x7fd26896ecb0)':
        [ { name: '8',
        value: '-9',
        type: 'integer',
        variablesReference: '0' },
        { name: 'bar',
        value: 'HASH(0x7fd2689527f0)',
        type: 'object',
        variablesReference: 'HASH(0x7fd2689527f0)' },
        { name: 'foo',
        value: 'bar',
        type: 'string',
        variablesReference: '0' },
        { name: 'list',
        value: 'ARRAY(0x7fd269242a50)',
        type: 'array',
        variablesReference: 'ARRAY(0x7fd269242a50)' },
        { name: 'ownObj',
        value: 'HASH(0x7fd26892c6c0)',
        type: 'object',
        variablesReference: 'HASH(0x7fd26892c6c0)' },
        { name: 'ownlist',
        value: '7',
        type: 'integer',
        variablesReference: '0' } ],
    'ARRAY(0x7fd269242a50)':
        [ { name: '0',
        value: 'a',
        type: 'string',
        variablesReference: '0' },
        { name: '1',
        value: '\\\'b',
        type: 'string',
        variablesReference: '0' },
        { name: '2',
        value: 'c',
        type: 'string',
        variablesReference: '0' },
        { name: '0',
        value: 'a',
        type: 'string',
        variablesReference: '0' },
        { name: '1',
        value: '\\\'b',
        type: 'string',
        variablesReference: '0' },
        { name: '2',
        value: 'c',
        type: 'string',
        variablesReference: '0' } ],
    'HASH(0x7fd26892c6c0)':
        [ { name: 'ownFoo',
        value: 'own?',
        type: 'string',
        variablesReference: '0' } ],
    'ARRAY(0x7fd269242a68)':
        [ { name: '0',
        value: '1',
        type: 'integer',
        variablesReference: '0' },
        { name: '1',
        value: '2',
        type: 'integer',
        variablesReference: '0' },
        { name: '2',
        value: '3',
        type: 'integer',
        variablesReference: '0' } ],
    'ARRAY(0x7fd269242b10)':
        [ { name: '0',
        value: 'a',
        type: 'string',
        variablesReference: '0' },
        { name: '1',
        value: '\\\'b',
        type: 'string',
        variablesReference: '0' },
        { name: '2',
        value: 'c',
        type: 'string',
        variablesReference: '0' },
        { name: '3',
        value: '1',
        type: 'integer',
        variablesReference: '0' },
        { name: '4',
        value: '2',
        type: 'integer',
        variablesReference: '0' },
        { name: '5',
        value: '3',
        type: 'integer',
        variablesReference: '0' }]
};

describe('variableParser', () => {
	it('works on good data', () => {
		const result = variableParser(data, 'local_0');

		assert.deepEqual(result, expectedResult);
	});
	it('works on faulty data', () => {
		const result = variableParser(dataFaulty, 'local_0');

		assert.deepEqual(result, expectedResult);
	});
});

describe('resolveVariable', () => {
	it('works', () => {
        const variables = variableParser(data, 'local_0');
		assert.equal(resolveVariable('8', 'HASH(0x7fd26896ecb0)', variables), '$obj->{8}');
		assert.equal(resolveVariable('$bar', 'local_0', variables), '$bar');
		assert.equal(resolveVariable('8', 'ARRAY(0x7fd269242a50)', variables), '$list1[8]');
		assert.equal(resolveVariable('ownFoo', 'HASH(0x7fd26892c6c0)', variables), '$obj->{ownObj}{ownFoo}');
	});
});
