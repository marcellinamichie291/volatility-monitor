import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { VolatilityMonitor } from "../target/types/volatility_monitor";

describe("volatility-monitor", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.VolatilityMonitor as Program<VolatilityMonitor>;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
