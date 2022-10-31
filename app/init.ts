import NodeWallet from '@project-serum/anchor/dist/cjs/nodewallet';
import { createPublicAggregator } from './utils/createPublicAggregator';

require('dotenv').config();
  
async function run() {
  const wallet = NodeWallet.local();
  await createPublicAggregator(wallet.payer);
}

run().then(
  () => process.exit(),
  err => {
    console.error(err);
    process.exit(-1);
  },
);
