// Copyright 2020-2024 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import fs from 'fs';
import {makeTempDir} from '@subql/common';
import {NodeConfig} from '../configure';
import {MonitorService} from './monitor.service';

class testMonitorService extends MonitorService {
  testGetBlockIndexEntries(height: number) {
    return (this as any).getBlockIndexEntries(height);
  }

  testResetFile(file: 'A' | 'B') {
    return (this as any).resetFile(file);
  }

  testRemoveIndexFile() {
    fs.rmSync((this as any).indexPath);
  }
}

function removeLinesFromFile(filePath: string, startLine: number, endLine: number): void {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');
    lines.splice(startLine - 1, endLine - startLine + 1);
    const updatedContent = lines.join('\n');
    fs.writeFileSync(filePath, updatedContent, 'utf-8');
    console.log(`Lines ${startLine}-${endLine} removed successfully from ${filePath}`);
  } catch (error) {
    console.error(`Error removing lines from file: ${error}`);
  }
}

describe('Monitor service', () => {
  let monitorDir: string;
  let monitorService1: testMonitorService;
  let nodeConfig: NodeConfig;
  beforeAll(async () => {
    monitorDir = await makeTempDir();
    nodeConfig = {monitorOutDir: monitorDir, monitorFileSize: 1024} as NodeConfig;
    monitorService1 = new testMonitorService(nodeConfig);
    monitorService1.init();
    monitorService1.resetAll();
  });
  afterAll(() => {
    fs.rmSync(monitorDir, {recursive: true, force: true});
  });

  function mockWriteBlockData(blockHeight: number, monitorService: MonitorService = monitorService1) {
    monitorService.createBlockStart(blockHeight);
    monitorService.write(`fetch block ${blockHeight}`);
    monitorService.write(`processing block ${blockHeight}`);
    monitorService.write(`block handler ${blockHeight}`);
    monitorService.write(`event handler ${blockHeight}, data :{entity: starter,{}}`);
    monitorService.write('post process');
    monitorService.write(`----- end block ${blockHeight}`);
  }

  it('monitor could write data', () => {
    mockWriteBlockData(55);
    expect(monitorService1.getBlockIndexRecords(55)).toContain('fetch block 55');
    expect(monitorService1.getBlockIndexRecords(55)).toContain('----- end block 55');
  });

  it('reset file', () => {
    mockWriteBlockData(55);
    monitorService1.testResetFile('A');
    // should get nothing from entries
    expect(monitorService1.testGetBlockIndexEntries(55)).toStrictEqual([]);
  });

  it('when write one file is full, it could rotate to next file, and could getBlockIndexEntries, getBlockIndexRecords', () => {
    // set to small size, so it could rotate
    const nodeConfig = {monitorOutDir: undefined, monitorFileSize: 150} as NodeConfig;
    const monitorService2 = new testMonitorService(nodeConfig);
    const spySwitchFile = jest.spyOn(monitorService2 as any, 'switchToFile');
    monitorService2.resetAll();
    const writeBlocks = [2, 5, 15, 25, 35, 55];
    for (const height of writeBlocks) {
      mockWriteBlockData(height, monitorService2);
    }
    expect(spySwitchFile).toHaveBeenCalledTimes(5);

    // getBlockIndexEntries
    expect(monitorService2.testGetBlockIndexEntries(25)).toStrictEqual([]);
    expect(monitorService2.testGetBlockIndexEntries(35)).toStrictEqual([
      {
        blockHeight: 35,
        endLine: 54,
        file: 'A',
        forked: false,
        startLine: 0,
      },
    ]);
    expect(monitorService2.testGetBlockIndexEntries(55)).toStrictEqual(
      // return two indexes as switch files, start in file A, end in file B
      [
        {
          blockHeight: 55,
          endLine: 7,
          file: 'A',
          forked: false,
          startLine: 6,
        },
        {
          blockHeight: 55,
          endLine: 5,
          file: 'B',
          forked: false,
          startLine: 0,
        },
      ]
    );
    // getBlockIndexRecords
    expect(monitorService2.getBlockIndexRecords(2)).toBeUndefined();
    expect(monitorService2.getBlockIndexRecords(55)).toStrictEqual([
      '+++++ Start block 55',
      'fetch block 55',
      'processing block 55',
      'block handler 55',
      'event handler 55, data :{entity: starter,{}}',
      'post process',
      '----- end block 55',
    ]);
  });

  it('handle block forks happens', () => {
    // set to small size, so it could rotate
    const monitorService2 = new testMonitorService(nodeConfig);
    monitorService2.resetAll();
    const beforeForkBlocks = [100, 105, 300];
    for (const height of beforeForkBlocks) {
      mockWriteBlockData(height, monitorService2);
    }
    monitorService2.createBlockFolk(102);
    const afterForkBlocks = [103, 105, 109, 300];
    for (const height of afterForkBlocks) {
      mockWriteBlockData(height, monitorService2);
    }
    monitorService2.createBlockFolk(200);
    expect(monitorService2.getForkedRecords()).toStrictEqual([
      '***** Forked at block 102',
      '***** Forked at block 200',
    ]);
    expect(monitorService2.getBlockIndexHistory()).toStrictEqual(
      // block 300 continued to file B, but we only keep one record here
      [100, 105, 300, 'Forked 102', 103, 105, 109, 300, 'Forked 200']
    );
  });

  it('init validation failed it could reset by itself', () => {
    const monitorService2 = new testMonitorService(nodeConfig);
    monitorService2.init();
    const beforeForkBlocks = [100, 105, 300];
    for (const height of beforeForkBlocks) {
      mockWriteBlockData(height, monitorService2);
    }
    const spyRestAll = jest.spyOn(monitorService2, 'resetAll');
    // Case 1 .Mock index file is lost
    monitorService2.testRemoveIndexFile();
    monitorService2.init();
    expect(spyRestAll).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();
    // Case 2 .Mock last index record block file is lost
    // Rewrite some data first
    for (const height of beforeForkBlocks) {
      mockWriteBlockData(height, monitorService2);
    }
    const lastIndexEntries = monitorService2.testGetBlockIndexEntries(300);
    // Mock file lost
    fs.rmSync((monitorService2 as any).getFilePath(lastIndexEntries[lastIndexEntries.length - 1].file));
    monitorService2.init();
    expect(spyRestAll).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();
    // Case 3 .Mock last index entry and corresponding file is found , but file is broken/missing records
    // Rewrite some data first
    for (const height of beforeForkBlocks) {
      mockWriteBlockData(height, monitorService2);
    }
    const block300Entry = monitorService2.testGetBlockIndexEntries(300)[0];
    // Mock lost block 300 record
    removeLinesFromFile(
      (monitorService2 as any).getFilePath(block300Entry.file),
      block300Entry.startLine,
      block300Entry.endLine
    );
    monitorService2.init();
    expect(spyRestAll).toHaveBeenCalledTimes(1);
  });
});
