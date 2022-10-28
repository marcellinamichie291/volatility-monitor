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

export async function createPublicAggregator(argv: any): Promise<void> {
  const { definitionFile, queueKey, authorityKeypair, outFile, force } = argv;
  // TODO: fetch real ones
  const authorityKeys = Keypair.generate();
  const program = await loadSwitchboardProgram(
    "mainnet-beta",
    new Connection('https://api.mainnet-beta.solana.com'),
    authorityKeys,
    {
      commitment: "finalized",
    }
  );

  const parsedAggregatorDefinition = loadAggregatorDefinition(definitionFile);
  if (!parsedAggregatorDefinition) {
    throw new Error(
      `failed to load aggregator definition from ${definitionFile}`
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

  console.log(chalk.yellow("######## Switchboard Setup ########"));
  const aggregatorSchema = await createAggregatorFromDefinition(
    program as any as Program<Idl>,
    parsedAggregatorDefinition,
    queueAccount
  );
  console.log(`Aggregator created succesfully `);
  saveAggregatorSchema(aggregatorSchema, outFile, force);
}