import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';

import { Contract } from '../managed/contract/index.js';
import { configForNetwork, contractConfig } from './config.js';
import { addressForSeed, buildWalletAndWaitForFunds, configureProviders } from './wallet.js';
import { describeError } from './errors.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_STATE_ID = 'proofAuditPrivateState';

async function main(): Promise<void> {
  const network = (process.argv[2] ?? 'preview').toLowerCase();
  loadEnv({ path: path.resolve(currentDir, '..', `.env.${network}`) });

  const seed = process.env.VAULT_CIRCLE_SEED || process.env.PROOF_AUDIT_SEED;
  if (!seed || !/^[0-9a-fA-F]{64}$/.test(seed.trim())) {
    throw new Error(`Missing or invalid PROOF_AUDIT_SEED in .env.${network}.`);
  }
  const seedHex = seed.trim();

  const config = configForNetwork(network);

  console.log(`\n▶ Deploying ProofAudit to "${network}"`);
  console.log(`  Wallet address (funding): ${addressForSeed(seedHex)}\n`);

  let walletCtx;
  try {
    walletCtx = await buildWalletAndWaitForFunds(config, seedHex);
  } catch (err) {
    console.error('\n✗ Wallet build/sync failed:\n', describeError(err));
    throw err;
  }

  const providers = await configureProviders(walletCtx, config);

  const compiled = CompiledContract.make('proof_audit', Contract).pipe(
    CompiledContract.withWitnesses({}),
    CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
  );

  const MAX_DEPLOY_ATTEMPTS = 1;
  
  for (let attempt = 1; attempt <= MAX_DEPLOY_ATTEMPTS; attempt++) {
    try {
      console.log(`\n  [Attempt ${attempt}] Deploying contract...`);
      const deployed = await deployContract(providers, {
        compiledContract: compiled,
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: {},
        args: [],
      });

      const address = deployed.deployTxData.public.contractAddress;

      console.log(`\n✅ Contract deployed successfully!\nNetwork: ${network}\nAddress: ${address}\n`);

      const outFile = path.resolve(currentDir, '..', `deployment.${network}.json`);
      writeFileSync(outFile, JSON.stringify({ network, contractAddress: address }, null, 2) + '\n');
      
      await walletCtx.wallet.close?.();
      process.exit(0);
    } catch (err: any) {
      console.error('\n✗ Deploy failed:\n', describeError(err));
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('\n✗ Deploy failed:\n', describeError(err));
  process.exit(1);
});
