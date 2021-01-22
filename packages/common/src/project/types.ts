// Copyright 2020-2021 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import {RegistryTypes} from '@polkadot/types/types';
import {SubqlKind} from './constants';

export interface ProjectManifest {
  specVersion: string;
  description: string;
  repository: string;

  schema: string;

  network: {
    endpoint: string;
    customTypes?: RegistryTypes;
  };

  dataSources: SubqlDataSource[];
}

// [startSpecVersion?, endSpecVersion?] closed range
export type SpecVersionRange = [number, number];

interface SubqlBaseHandlerFilter {
  specVersion?: SpecVersionRange;
}

export type SubqlBlockFilter = SubqlBaseHandlerFilter;

export interface SubqlEventFilter extends SubqlBaseHandlerFilter {
  module?: string;
  method?: string;
}

export interface SubqlCallFilter extends SubqlEventFilter {
  success?: boolean;
}

export interface SubqlBlockHandler {
  handler: string;
  kind: 'substrate/BlockHandler';
  filter?: SubqlBlockFilter;
}

export interface SubqlCallHandler {
  handler: string;
  kind: 'substrate/CallHandler';
  filter?: SubqlCallFilter;
}

export interface SubqlEventHandler {
  handler: string;
  kind: 'substrate/EventHandler';
  filter?: SubqlEventFilter;
}

export type SubqlHandler = SubqlBlockHandler | SubqlCallHandler | SubqlEventHandler;

export type SubqlHandlerFilter = SubqlBlockFilter | SubqlCallFilter | SubqlEventFilter;

export interface SubqlMapping {
  handlers: SubqlHandler[];
}

export interface SubqlDatasource {
  name: string;
  kind: SubqlKind;
  startBlock?: number;
  mapping: SubqlMapping;
}

export interface SubqlRuntimeDatasource extends SubqlDatasource {
  kind: SubqlKind.Runtime;
}

export type SubqlDataSource = SubqlRuntimeDatasource;
