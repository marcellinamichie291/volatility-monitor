import * as anchor from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import { OracleJob } from "@switchboard-xyz/switchboard-api";
import { SwitchboardPermissionValue } from "@switchboard-xyz/switchboard-v2";
import {
  AggregatorAccount,
  JobAccount,
  LeaseAccount,
  OracleQueueAccount,
  PermissionAccount,
  ProgramStateAccount,
  programWallet,
  SwitchboardProgram,
} from "@switchboard-xyz/switchboard-v2";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import readLineSync from "readline-sync";

export interface PdaSchema {
  name?: string;
  publicKey?: PublicKey;
}

export interface AuthoritySchema extends PdaSchema {
  secretKey?: Uint8Array;
}

export interface PermissionSchema extends PdaSchema {
  queuePermission: string;
  expiration?: number;
  granter?: PublicKey;
  grantee?: PublicKey;
}

export interface JobSchema extends AuthoritySchema {
  tasks?: OracleJob.ITask[];
}

export interface AggregatorSchema extends AuthoritySchema {
  name: string;
  batchSize?: number;
  minRequiredOracleResults?: number;
  minRequiredJobResults?: number;
  minUpdateDelaySeconds?: number;
  permission?: PermissionSchema;
  lease?: PdaSchema;
  jobs: JobSchema[];
}

export const pubKeyConverter = (key: any, value: any): any => {
  if (value instanceof PublicKey) {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return `[${value.toString()}]`;
  }
  return value;
};

export const pubKeyReviver = (key, value): any => {
  if (key === "publicKey") {
    return new PublicKey(value);
  }
  if (key === "secretKey") {
    return new Uint8Array(JSON.parse(value));
  }
  return value;
};

export const saveAggregatorSchema = (
  aggregatorSchema: AggregatorSchema,
  outFile: string,
  force = false
): void => {
  const fullPath = path.join(__dirname, outFile);

  if (!force && fs.existsSync(fullPath)) {
    console.log(fullPath);
    if (!readLineSync.keyInYN("Do you want to overwrite this file?")) {
      console.log(
        `Aggregator Schema: already existed, skipping ${fullPath}`
      );
      return;
    }
  }
  fs.writeFileSync(
    fullPath,
    JSON.stringify(aggregatorSchema, pubKeyConverter, 2)
  );
  console.log(
    `Aggregator Schema: saved to ${chalk.green(fullPath)}`
  );
};

export const loadAggregatorDefinition = (
  inputFile: string
): AggregatorSchema | undefined => {
  const fullInputFilePath = path.join(__dirname, inputFile);
  if (!fs.existsSync(fullInputFilePath))
    throw new Error(`input file does not exist ${fullInputFilePath}`);

  try {
    const definitionString = fs.readFileSync(fullInputFilePath, "utf8");
    const definition: AggregatorSchema = JSON.parse(
      definitionString,
      pubKeyReviver
    );
    return definition;
  } catch {
    return undefined;
  }
};

export const toUtf8 = (array): string => {
  return String.fromCharCode(...array).replace(/\u0000/g, "");
};

export const toPermissionString = (
  permission: SwitchboardPermissionValue
): string => {
  switch (permission) {
    case SwitchboardPermissionValue.PERMIT_ORACLE_HEARTBEAT:
      return "PERMIT_ORACLE_HEARTBEAT";
    case SwitchboardPermissionValue.PERMIT_ORACLE_QUEUE_USAGE:
      return "PERMIT_ORACLE_QUEUE_USAGE";
    default:
      return "NONE";
  }
};

export async function createAggregatorFromDefinition(
  program: anchor.Program,
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

  // Aggregator Permissions
  const aggregatorPermission = await PermissionAccount.create(switchBoardProgram, {
    authority: programWallet(switchBoardProgram).publicKey,
    granter: new PublicKey(queueAccount.publicKey),
    grantee: aggregatorAccount.publicKey,
  });
  console.log(`  Permission`, aggregatorPermission.publicKey);

  // Lease
  const [programStateAccount] = ProgramStateAccount.fromSeed(switchBoardProgram);
  const switchTokenMint = await programStateAccount.getTokenMint();
  const tokenAccount = await (switchTokenMint as any).getOrCreateAssociatedAccountInfo(
    programWallet(switchBoardProgram).publicKey
  );
  const leaseContract = await LeaseAccount.create(switchBoardProgram, {
    loadAmount: new anchor.BN(0),
    funder: tokenAccount.address,
    funderAuthority: programWallet(switchBoardProgram),
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