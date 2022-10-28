import { Idl, Program } from '@project-serum/anchor';
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  loadSwitchboardProgram,
  OracleQueueAccount,
} from "@switchboard-xyz/switchboard-v2";
import chalk from "chalk";
import {
  createAggregatorFromDefinition,
  loadAggregatorDefinition,
  saveAggregatorSchema,
} from "./schema";
import path from 'path';

export async function createPublicAggregator(authorityKeypair: Keypair): Promise<void> {
  const queueKey = 'B4yBQ3hYcjnrNLxUnauJqwpFJnjtm7s8gHybgkAdgXhQ';
  const program = await loadSwitchboardProgram(
    'devnet',
    new Connection('https://api.devnet.solana.com'),
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
  const aggregatorSchema = await createAggregatorFromDefinition(
    program as any as Program<Idl>,
    parsedAggregatorDefinition,
    queueAccount
  );
  const outFile = path.join('..', 'outFile.json');
  console.log(`Aggregator created succesfully `);
  saveAggregatorSchema(aggregatorSchema, outFile, false);
}
