import { Idl, Program } from '@project-serum/anchor';
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  loadSwitchboardProgram,
  OracleQueueAccount,
} from "@switchboard-xyz/switchboard-v2";
import chalk from "chalk";
import {
  loadAggregatorDefinition,
  saveAggregatorSchema,
} from "./schema";
import path from 'path';
import { createAggregatorFromDefinition, CreateAggregatorFromDefinitionArgs } from './createAggregatorFromDefinition';

export async function createPublicAggregator(authorityKeypair: Keypair): Promise<void> {
  const queueKey = 'B4yBQ3hYcjnrNLxUnauJqwpFJnjtm7s8gHybgkAdgXhQ';
  const connection = new Connection('https://api.devnet.solana.com');
  const program = await loadSwitchboardProgram(
    'devnet',
    connection,
    authorityKeypair,
    {
      commitment: 'finalized',
    }
  );
  const definitionPath = path.join('..', 'aggregator-definition.json');
  const parsedAggregatorDefinition = loadAggregatorDefinition(definitionPath);
  if (!parsedAggregatorDefinition) {
    throw new Error(
      `failed to load aggregator definition from ${definitionPath}`
    );
  }
  if (parsedAggregatorDefinition.jobs.length === 0) {
    throw new Error(`no aggregator jobs defined`);
  }

  const queuePubkey = new PublicKey(queueKey);
  const queueAccount = new OracleQueueAccount({
    program,
    publicKey: queuePubkey,
  });

  console.log(chalk.yellow('######## Switchboard Setup ########'));
  const aggregatorSchema = await createAggregatorFromDefinition(program, parsedAggregatorDefinition, queueAccount);
  const outFile = path.join('..', 'outFile.json');
  console.log(`Aggregator created succesfully `);
  saveAggregatorSchema(aggregatorSchema, outFile, false);
}
