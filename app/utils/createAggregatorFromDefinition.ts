import * as anchor from "@project-serum/anchor";
import {
  createAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { OracleJob } from '@switchboard-xyz/switchboard-api';
import { AggregatorAccount, JobAccount, LeaseAccount, OracleQueueAccount, PermissionAccount, ProgramStateAccount, programWallet, SwitchboardProgram } from '@switchboard-xyz/switchboard-v2';
import { AggregatorSchema, JobSchema, toPermissionString, toUtf8 } from './schema';

export type CreateAggregatorFromDefinitionArgs = {
  program: anchor.Program;
  definition: AggregatorSchema;
  queueAccount: OracleQueueAccount;
  walletKeys: Keypair;
  connection: Connection;
}

export async function createAggregatorFromDefinition(
  { program, definition, queueAccount, walletKeys, connection }: CreateAggregatorFromDefinitionArgs
): Promise<AggregatorSchema> {
  // Aggregator
  const feedName = definition.name;
  const {
    jobs,
    batchSize,
    minRequiredOracleResults,
    minRequiredJobResults,
    minUpdateDelaySeconds,
  } = definition;
  const switchBoardProgram = program as any as SwitchboardProgram;
  const aggregatorAccount = await AggregatorAccount.create(switchBoardProgram, {
    name: Buffer.from(feedName),
    batchSize: batchSize || 1,
    minRequiredOracleResults: minRequiredOracleResults || 1,
    minRequiredJobResults: minRequiredJobResults || 1,
    minUpdateDelaySeconds: minUpdateDelaySeconds || 10,
    queueAccount: queueAccount,
    authority: programWallet(switchBoardProgram).publicKey,
  });
  console.log(
    `Aggregator (${feedName})`, aggregatorAccount.publicKey
  );
  if (!aggregatorAccount.publicKey)
    throw new Error(`failed to read Aggregator publicKey`);
  const aggregatorPermission = await PermissionAccount.create(switchBoardProgram, {
    authority: programWallet(switchBoardProgram).publicKey,
    granter: new PublicKey(queueAccount.publicKey),
    grantee: aggregatorAccount.publicKey,
  });
  console.log(`  Permission`, aggregatorPermission.publicKey);
  const [programStateAccount] = ProgramStateAccount.fromSeed(switchBoardProgram);
  const switchTokenMint = await programStateAccount.getTokenMint();
  const switchBoardWalletPk = programWallet(switchBoardProgram).publicKey;
  console.log(1);
  let ata = await createAssociatedTokenAccount(
    connection, // connection
    walletKeys, // fee payer
    switchTokenMint.address, // mint
    switchBoardWalletPk // owner,
  );
  console.log(2);
  let tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      walletKeys.publicKey, // payer
      ata, // ata
      switchBoardWalletPk, // owner
      switchTokenMint.address // mint
    )
  );
  await sendAndConfirmTransaction(connection, tx, [walletKeys]);
  console.log(3);
  // const tokenAccount = await (switchTokenMint as any).getOrCreateAssociatedAccountInfo(
  //   programWallet(switchBoardProgram).publicKey
  // );
  const leaseContract = await LeaseAccount.create(switchBoardProgram, {
    loadAmount: new anchor.BN(0),
    funder: ata,
    funderAuthority: programWallet(switchBoardProgram),
    oracleQueueAccount: queueAccount,
    aggregatorAccount,
  });
  console.log(`  Lease`, leaseContract.publicKey);
  const jobSchemas: JobSchema[] = [];
  for await (const job of jobs) {
    const { name, tasks } = job;
    const jobData = Buffer.from(
      OracleJob.encodeDelimited(
        OracleJob.create({
          tasks,
        })
      ).finish()
    );
    const jobKeypair = anchor.web3.Keypair.generate();
    const jobAccount = await JobAccount.create(switchBoardProgram, {
      data: jobData,
      keypair: jobKeypair,
      authority: programWallet(switchBoardProgram).publicKey,
    });
    console.log(`  Job (${name})`, jobAccount.publicKey);
    await aggregatorAccount.addJob(jobAccount, programWallet(switchBoardProgram)); // Add Job to Aggregator
    const jobSchema: JobSchema = {
      name,
      publicKey: jobAccount.publicKey,
      secretKey: jobKeypair.secretKey,
      tasks,
    };
    jobSchemas.push(jobSchema);
  }
  const aggregatorData = await aggregatorAccount.loadData();
  const permissionData = await aggregatorPermission.loadData();
  const newAggregatorDefinition: AggregatorSchema = {
    ...definition,
    name: toUtf8(aggregatorData.name),
    publicKey: aggregatorAccount.publicKey,
    batchSize: aggregatorData.batchSize,
    minRequiredOracleResults: aggregatorData.minRequiredOracleResults,
    minRequiredJobResults: aggregatorData.minRequiredJobResults,
    minUpdateDelaySeconds: aggregatorData.minUpdateDelaySeconds,
    permission: {
      publicKey: aggregatorPermission.publicKey,
      expiration: permissionData.expiration,
      queuePermission: toPermissionString(permissionData.permissions),
      granter: permissionData.granter,
      grantee: permissionData.grantee,
    },
    lease: {
      publicKey: leaseContract.publicKey,
    },
    jobs: jobSchemas,
  };
  return newAggregatorDefinition;
}

