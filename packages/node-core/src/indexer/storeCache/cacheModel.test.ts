// Copyright 2020-2024 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {Sequelize, DataTypes} from '@subql/x-sequelize';
import {padStart} from 'lodash';
import {DbOption, NodeConfig} from '../../';
import {CachedModel} from './cacheModel';

const option: DbOption = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASS ?? 'postgres',
  database: process.env.DB_DATABASE ?? 'postgres',
  timezone: 'utc',
};

jest.setTimeout(10_000);

describe('cacheMetadata integration', () => {
  let sequelize: Sequelize;
  let schema: string;
  let model: any;
  let cacheModel: CachedModel<{id: string; field1: number}>;

  const flush = async (blockHeight: number) => {
    const tx = await sequelize.transaction();
    await cacheModel.flush(tx, blockHeight);
    await tx.commit();
  };

  beforeAll(async () => {
    sequelize = new Sequelize(
      `postgresql://${option.username}:${option.password}@${option.host}:${option.port}/${option.database}`,
      option
    );
    await sequelize.authenticate();

    schema = '"model-test-1"';
    await sequelize.createSchema(schema, {});

    // TODO create model
    const modelFactory = sequelize.define(
      'testModel',
      {
        id: {
          type: DataTypes.STRING,
          primaryKey: true,
        },
        field1: DataTypes.INTEGER,
      },
      {timestamps: false, schema: schema}
    );
    model = await modelFactory.sync().catch((e) => {
      console.log('error', e);
      throw e;
    });

    let i = 0;

    cacheModel = new CachedModel(model, false, new NodeConfig({} as any), () => i++);
  });

  afterAll(async () => {
    await sequelize.dropSchema(schema, {logging: false});
    await sequelize.close();
  });

  describe('getByFields', () => {
    const formatIdNumber = (n: number): string => padStart(`${n}`, 3, '0');

    beforeAll(async () => {
      // Pre-populate some data and flush it do the db
      let n = 0;
      while (n < 100) {
        cacheModel.set(
          `entity1_id_0x${formatIdNumber(n)}`,
          {
            id: `entity1_id_0x${formatIdNumber(n)}`,
            field1: 1,
          },
          1
        );
        n++;
      }

      await flush(2);

      // Updates to existing data
      let m = 20;
      while (m < 30) {
        cacheModel.set(
          `entity1_id_0x${formatIdNumber(m)}`,
          {
            id: `entity1_id_0x${formatIdNumber(m)}`,
            field1: m % 2,
          },
          3
        );
        m++;
      }

      // New data
      let o = 100;
      while (o < 130) {
        cacheModel.set(
          `entity1_id_0x${formatIdNumber(o)}`,
          {
            id: `entity1_id_0x${formatIdNumber(o)}`,
            field1: 2,
          },
          3
        );
        o++;
      }
    });

    it('gets one item correctly', async () => {
      // Db value
      const res0 = await cacheModel.getOneByField('id', 'entity1_id_0x001');
      expect(res0).toEqual({id: 'entity1_id_0x001', field1: 1});

      // Cache value
      const res1 = await cacheModel.getOneByField('id', 'entity1_id_0x020');
      expect(res1).toEqual({id: 'entity1_id_0x020', field1: 0});

      // Cache value
      const res2 = await cacheModel.getOneByField('id', 'entity1_id_0x021');
      expect(res2).toEqual({id: 'entity1_id_0x021', field1: 1});
    });

    it('corretly merges data from the setCache', async () => {
      const results = await cacheModel.getByFields(
        // Any needed to get past type check
        [['field1', '=', 1]],
        {offset: 0, limit: 30}
      );

      expect(results.length).toEqual(30);

      // This should exclude all the cache values where field1 = 0
      // The database would still have those values as 1
      expect(results.map((res) => res.id)).toEqual([
        // Cache Data
        'entity1_id_0x021',
        'entity1_id_0x023',
        'entity1_id_0x025',
        'entity1_id_0x027',
        'entity1_id_0x029',
        // DB data
        'entity1_id_0x000',
        'entity1_id_0x001',
        'entity1_id_0x002',
        'entity1_id_0x003',
        'entity1_id_0x004',
        'entity1_id_0x005',
        'entity1_id_0x006',
        'entity1_id_0x007',
        'entity1_id_0x008',
        'entity1_id_0x009',
        'entity1_id_0x010',
        'entity1_id_0x011',
        'entity1_id_0x012',
        'entity1_id_0x013',
        'entity1_id_0x014',
        'entity1_id_0x015',
        'entity1_id_0x016',
        'entity1_id_0x017',
        'entity1_id_0x018',
        'entity1_id_0x019',
        'entity1_id_0x030',
        'entity1_id_0x031',
        'entity1_id_0x032',
        'entity1_id_0x033',
        'entity1_id_0x034',
      ]);
    });

    it('corretly orders and offsets data with setCache', async () => {
      const results = await cacheModel.getByFields([['field1', 'in', [0, 1]]], {
        offset: 15,
        limit: 10,
        orderBy: 'field1',
        orderDirection: 'DESC',
      });

      expect(results.length).toEqual(10);
      expect(results.map((r) => r.field1)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it('gets correct results with no filter', async () => {
      // Cache data first
      const ids: string[] = [];
      let n = 20;
      while (n < 30) {
        ids.push(`entity1_id_0x${formatIdNumber(n)}`);
        n++;
      }
      n = 100;
      while (n < 130) {
        ids.push(`entity1_id_0x${formatIdNumber(n)}`);
        n++;
      }

      // TODO make limit bigger to get DB data as well

      const results = await cacheModel.getByFields([], {offset: 0, limit: 30});

      expect(results.map((r) => r.id)).toEqual(ids.slice(0, 30));
    });

    describe('offsets with cache data', () => {
      let fullResults: {id: string; field1: number}[];

      beforeAll(async () => {
        fullResults = await cacheModel.getByFields([], {offset: 0, limit: 50});
      });

      it('gets data before cache', async () => {
        const results = await cacheModel.getByFields([], {offset: 5, limit: 15});
        expect(results).toEqual(fullResults.slice(5).slice(0, 15));
      });

      it('gets data before and in cache', async () => {
        const results = await cacheModel.getByFields([], {offset: 15, limit: 20});
        expect(results).toEqual(fullResults.slice(15).slice(0, 20));
      });

      it('gets data within cache', async () => {
        const results = await cacheModel.getByFields([], {offset: 20, limit: 5});
        expect(results).toEqual(fullResults.slice(20).slice(0, 5));
      });

      it('gets data after cache', async () => {
        const results = await cacheModel.getByFields([], {offset: 30, limit: 20});
        expect(results).toEqual(fullResults.slice(30).slice(0, 20));
      });
    });

    describe('data only in cache', () => {
      it('selects data in the cache', async () => {
        const result = await cacheModel.getByFields([['field1', '=', 2]]);
        expect(result.length).toEqual(30);
      });

      it('selects data from the cache and db in the right order', async () => {
        const result = await cacheModel.getByFields([], {limit: 50, orderDirection: 'DESC'});
        expect(result[0].id).toEqual('entity1_id_0x129'); // Failing because we cant offset cache data correctly
        expect(result[result.length - 1].id).toEqual('entity1_id_0x090');
      });
    });
  });
});
