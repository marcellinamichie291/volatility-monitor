import { BN, Program, web3 } from '@project-serum/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import { OracleJob } from '@switchboard-xyz/switchboard-api';
import {
  AggregatorAccount,
  JobAccount,
  LeaseAccount,
  OracleQueueAccount,
  PermissionAccount,
  ProgramStateAccount,
  programWallet,
} from '@switchboard-xyz/switchboard-v2';
import { AggregatorSchema, JobSchema, toPermissionString, toUtf8 } from './schema';

export type CreateAggregatorFromDefinitionArgs = {
  program: Program;
  definition: AggregatorSchema;
  queueAccount: OracleQueueAccount;
  walletKeys: Keypair;
  connection: Connection;
}

export async function createAggregatorFromDefinition(
  program: Program,
  definition: AggregatorSchema,
  queueAccount: OracleQueueAccount
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
  const aggregatorAccount = await AggregatorAccount.create(program, {
    name: Buffer.from(feedName),
    batchSize: batchSize || 1,
    minRequiredOracleResults: minRequiredOracleResults || 1,
    minRequiredJobResults: minRequiredJobResults || 1,
    minUpdateDelaySeconds: minUpdateDelaySeconds || 10,
    queueAccount: queueAccount,
    authority: programWallet(program).publicKey,
  });
  console.log(
    `Aggregator (${feedName})`, aggregatorAccount.publicKey
  );
  if (!aggregatorAccount.publicKey)
    throw new Error(`failed to read Aggregator publicKey`);

  // Aggregator Permissions
  const aggregatorPermission = await PermissionAccount.create(program, {
    authority: programWallet(program).publicKey,
    granter: new PublicKey(queueAccount.publicKey),
    grantee: aggregatorAccount.publicKey,
  });
  console.log(`  Permission`, aggregatorPermission.publicKey);

  // Lease
  const [programStateAccount] = ProgramStateAccount.fromSeed(program);
  const switchTokenMint = await programStateAccount.getTokenMint();
  const tokenAccount = await switchTokenMint.getOrCreateAssociatedAccountInfo(
    programWallet(program).publicKey
  );
  const leaseContract = await LeaseAccount.create(program, {
    loadAmount: new BN(0),
    funder: tokenAccount.address,
    funderAuthority: programWallet(program),
    oracleQueueAccount: queueAccount,
    aggregatorAccount,
  });
  console.log(`  Lease`, leaseContract.publicKey);

  // Jobs
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
    const jobKeypair = web3.Keypair.generate();
    const jobAccount = await JobAccount.create(program, {
      data: jobData,
      keypair: jobKeypair,
      authority: programWallet(program).publicKey,
    });
    console.log(`  Job (${name})`, jobAccount.publicKey);
    await aggregatorAccount.addJob(jobAccount, programWallet(program)); // Add Job to Aggregator
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
