/** Diagrams for the /architecture page. */

import {
  Arrow,
  Box,
  DiagramFrame,
  Lane,
  Lifeline,
  Msg,
  Note,
  SelfMsg,
} from "@/components/tech/diagram";

/* ── 1. system map ── */

export function SystemMap() {
  return (
    <DiagramFrame
      title="System map — four planes, one asset path"
      note="services relay between the chains; they are never trusted by them"
      viewBox="0 0 1000 630"
      minWidth={900}
      legend={[
        { tone: "btc", label: "Bitcoin" },
        { tone: "gray", label: "Off-chain services" },
        { tone: "sol", label: "Solana programs" },
        { tone: "ika", label: "Ika threshold custody" },
        { tone: "er", label: "MagicBlock ER" },
      ]}
    >
      {/* Bitcoin */}
      <Lane x={16} y={16} w={968} h={112} label="Bitcoin L1" tone="btc" />
      <Box x={36} y={44} w={180} h={70} tone="btc" title="Depositor" lines={["any wallet"]} />
      <Box
        x={256}
        y={44}
        w={230}
        h={70}
        tone="btc"
        title="Deposit address"
        lines={["P2TR, output key", "tweaked by npk"]}
      />
      <Box
        x={526}
        y={44}
        w={250}
        h={70}
        tone="ika"
        title="Pool vault UTXOs"
        lines={["P2TR held by the pool's", "own Ika dWallet"]}
      />
      <Box x={816} y={44} w={148} h={70} tone="btc" title="Recipient" lines={["payout output"]} />
      <Arrow d="M 216 79 L 256 79" tone="btc" />
      <Arrow d="M 486 79 L 526 79" tone="btc" label="sweep" lx={506} ly={70} />
      <Arrow d="M 776 79 L 816 79" tone="ika" label="payout" lx={796} ly={70} />

      {/* Services */}
      <Lane x={16} y={156} w={968} h={118} label="Off-chain services" />
      <Box
        x={36}
        y={186}
        w={176}
        h={76}
        title="Deposit tracker"
        lines={["watch, sweep,", "submit SPV"]}
      />
      <Box x={228} y={186} w={176} h={76} title="Header relayer" lines={["BTC headers →", "light client"]} />
      <Box
        x={420}
        y={186}
        w={176}
        h={76}
        title="Redemption svc"
        lines={["build tx, sighash,", "broadcast"]}
      />
      <Box x={612} y={186} w={176} h={76} title="Event indexer" lines={["logs → leaves,", "nullifiers"]} />
      <Box
        x={804}
        y={186}
        w={176}
        h={76}
        tone="er"
        title="Policy coord."
        lines={["TDX enclave,", "Verified pool only"]}
      />

      {/* Solana */}
      <Lane x={16} y={302} w={968} h={200} label="Solana L1" tone="sol" />
      <Box
        x={36}
        y={326}
        w={250}
        h={76}
        tone="btc"
        title="btc-light-client"
        lines={["header chain + PoW,", "VerifiedTransaction PDAs"]}
      />
      <Box
        x={330}
        y={346}
        w={340}
        h={112}
        tone="sol"
        title="utxopia — asset program"
        lines={[
          "PoolState · CommitmentTree(16)",
          "NullifierRecord · VkRegistry",
          "TokenConfig · RedemptionRequest",
          "UtxoRecord · DepositReceipt",
        ]}
      />
      <Box
        x={714}
        y={326}
        w={250}
        h={76}
        tone="ika"
        title="Ika dWallet program"
        lines={["MessageApproval + Sign", "accounts for the vault key"]}
      />
      <Box
        x={714}
        y={418}
        w={250}
        h={66}
        tone="zk"
        title="utxopia-policy"
        lines={["one-time PolicyApproval PDAs"]}
      />
      <Arrow d="M 286 364 L 330 364" tone="btc" label="SPV" lx={308} ly={356} />
      <Arrow d="M 670 364 L 714 364" tone="ika" label="CPI" lx={692} ly={356} />
      <Arrow d="M 670 440 L 714 440" tone="zk" label="CPI" lx={692} ly={432} both />

      {/* cross-plane edges */}
      <Arrow
        d="M 195 186 L 195 148 L 300 148 L 300 116"
        dashed
        label="watch address"
        lx={250}
        ly={142}
      />
      <Arrow d="M 316 262 L 316 292 L 161 292 L 161 326" tone="btc" label="headers" lx={238} ly={286} />
      <Arrow d="M 508 262 L 508 330 L 450 330 L 450 346" tone="sol" label="instructions" lx={520} ly={290} anchor="start" />
      <Arrow d="M 420 346 L 420 314 L 700 314 L 700 262" dashed label="sol_log_data" lx={636} ly={308} />
      <Arrow
        d="M 892 262 L 892 296 L 988 296 L 988 451 L 964 451"
        tone="er"
        label="policy txs"
        lx={884}
        ly={288}
        anchor="end"
      />

      {/* MagicBlock */}
      <Lane x={16} y={518} w={968} h={96} label="MagicBlock ephemeral rollup" tone="er" />
      <Box
        x={714}
        y={544}
        w={250}
        h={56}
        tone="er"
        title="PolicyApproval (delegated)"
        lines={["decided privately inside PER"]}
      />
      <Arrow d="M 839 484 L 839 544" tone="er" both label="delegate / commit" lx={825} ly={512} anchor="end" />
      <Note
        x={40}
        y={556}
        lines={[
          "Only the approval account is ever delegated.",
          "Notes, nullifiers, trees, the zkBTC supply and the",
          "vault key never leave Solana or Bitcoin.",
        ]}
      />
    </DiagramFrame>
  );
}

/* ── 2. deposit ── */

const COL = { user: 78, btc: 288, be: 508, lc: 722, prog: 918 };

export function DepositFlow() {
  return (
    <DiagramFrame
      title="Deposit — bitcoin in, shielded note out"
      note="the commitment is computed on chain, not supplied"
      viewBox="0 0 1000 700"
      minWidth={960}
    >
      <Lifeline x={COL.user} y={14} h={660} label="User wallet" sub="browser / SDK" />
      <Lifeline x={COL.btc} y={14} h={660} label="Bitcoin L1" sub="mempool + blocks" tone="btc" />
      <Lifeline x={COL.be} y={14} h={660} label="Backend" sub="tracker + relayer" />
      <Lifeline x={COL.lc} y={14} h={660} label="btc-light-client" sub="Solana program" tone="btc" />
      <Lifeline x={COL.prog} y={14} h={660} label="utxopia" sub="asset program" tone="sol" />

      <Msg n={1} from={COL.user} to={COL.be} y={100} label="register deposit" sub="npk derived client-side via ECDH" />
      <Msg n={2} from={COL.be} to={COL.user} y={146} label="P2TR deposit address" sub="output key tweaked by npk" />
      <Msg
        n={3}
        from={COL.user}
        to={COL.btc}
        y={192}
        tone="btc"
        label="send BTC + OP_RETURN"
        sub="ver(1) | pool_tag(8) | eph(32) | npk(32)"
      />
      <Msg n={4} from={COL.btc} to={COL.be} y={238} dashed label="deposit seen" sub="mempool.space WS / Esplora poll" />
      <Msg n={5} from={COL.be} to={COL.btc} y={284} tone="btc" label="sweep to the pool vault" sub="P2TR of the pool's dWallet — no OP_RETURN" />
      <Msg n={6} from={COL.be} to={COL.lc} y={330} tone="btc" label="relay headers" sub="PoW chain + tip height" />
      <Msg n={7} from={COL.be} to={COL.lc} y={376} tone="btc" label="verify_transaction" sub="merkle proof → VerifiedTransaction PDA" />
      <Msg n={8} from={COL.be} to={COL.prog} y={422} tone="sol" label="upload raw tx" sub="ChadBuffer account" />
      <Msg
        n={9}
        from={COL.be}
        to={COL.prog}
        y={468}
        tone="sol"
        label="complete_deposit"
        sub="sweep_txid, height, sizes, deposit_txid — 80 B"
      />
      <SelfMsg
        n={10}
        x={COL.prog}
        y={520}
        w={300}
        side="left"
        tone="sol"
        label="read npk + amount on chain"
        sub="OP_RETURN parse + SPV-verified output value"
      />
      <SelfMsg
        n={11}
        x={COL.prog}
        y={572}
        w={300}
        side="left"
        tone="sol"
        label="commitment = Poseidon(npk, token, net)"
        sub="leaf appended to CommitmentTree, depth 16"
      />
      <SelfMsg
        n={12}
        x={COL.prog}
        y={624}
        w={300}
        side="left"
        tone="sol"
        label="mint zkBTC to the vault"
        sub="collateral == shielded note value"
      />
      <Msg n={13} from={COL.prog} to={COL.be} y={670} dashed label="stealth announcement" sub="sol_log_data → indexer → wallet scan" />
    </DiagramFrame>
  );
}

/* ── 3. zk ── */

export function JoinSplitDiagram() {
  return (
    <DiagramFrame
      title="JoinSplit — what the circuit proves, and what the chain checks"
      note="45 compiled variants, n inputs + m outputs ≤ 10"
      viewBox="0 0 1000 540"
      minWidth={920}
      legend={[
        { tone: "zk", label: "off-chain proving" },
        { tone: "sol", label: "on-chain verification" },
      ]}
    >
      <Box
        x={24}
        y={20}
        w={290}
        h={160}
        tone="zk"
        title="Private witness"
        tag="never leaves the client"
        lines={[
          "nullifyingKey (nk)",
          "publicKey[2] — Baby JubJub",
          "signature[3] — EdDSA-Poseidon",
          "valueIn[n], randomIn[n], token",
          "pathElements[n][16], leafIndices[n]",
          "npkOut[m], valueOut[m]",
        ]}
      />

      <Lane x={348} y={20} w={310} h={232} label="JoinSplit(n, m, depth 16)" tone="zk" upper={false} />
      <Box
        x={364}
        y={44}
        w={278}
        h={46}
        tone="zk"
        title="1 · Ownership"
        lines={["EdDSA sig binds nk to this spend"]}
      />
      <Box
        x={364}
        y={94}
        w={278}
        h={46}
        tone="zk"
        title="2 · Membership"
        lines={["Merkle path from each note to root"]}
      />
      <Box
        x={364}
        y={144}
        w={278}
        h={46}
        tone="zk"
        title="3 · Nullifier"
        lines={["derived from nk + leaf index"]}
      />
      <Box
        x={364}
        y={194}
        w={278}
        h={46}
        tone="zk"
        title="4 · Balance"
        lines={["Σ in = Σ out, values range-checked"]}
      />

      <Box
        x={700}
        y={20}
        w={276}
        h={122}
        tone="sol"
        title="Public signals"
        lines={["merkleRoot", "boundParamsHash", "nullifiers[n]", "commitmentsOut[m]"]}
      />
      <Note
        x={700}
        y={162}
        tone="sol"
        lines={["Amounts, senders and recipients", "are not among them."]}
      />

      <Arrow d="M 314 100 L 348 100" tone="zk" />
      <Arrow d="M 658 100 L 700 100" tone="zk" />
      <Arrow
        d="M 940 142 L 940 300"
        tone="sol"
        label="Groth16 proof + public signals"
        lx={930}
        ly={220}
        anchor="end"
      />

      <Lane x={24} y={300} w={952} h={214} label="Solana — transact / unshield / redeem" tone="sol" />
      <Box
        x={42}
        y={330}
        w={296}
        h={76}
        tone="sol"
        title="Groth16 verify"
        lines={["VkRegistry[n×m] → vk", "alt_bn128 pairing syscalls"]}
      />
      <Box
        x={360}
        y={330}
        w={296}
        h={76}
        tone="sol"
        title="Root freshness"
        lines={["merkleRoot must be a known root", "of the active or a frozen tree"]}
      />
      <Box
        x={678}
        y={330}
        w={296}
        h={76}
        tone="sol"
        title="Bound params"
        lines={["boundParamsHash pins fee,", "destination, pool and tree"]}
      />
      <Box
        x={42}
        y={422}
        w={296}
        h={76}
        tone="sol"
        title="Nullifier PDAs"
        lines={["one PDA per nullifier —", "a replay simply cannot create it"]}
      />
      <Box
        x={360}
        y={422}
        w={296}
        h={76}
        tone="sol"
        title="New leaves"
        lines={["commitmentsOut appended", "to the active tree"]}
      />
      <Box
        x={678}
        y={422}
        w={296}
        h={76}
        tone="sol"
        title="Stealth announcements"
        lines={["72 B per output, logged so", "recipients can find their notes"]}
      />
    </DiagramFrame>
  );
}

/* ── 4. ika ── */

const WCOL = { wallet: 76, prog: 286, be: 496, ika: 706, btc: 916 };

export function WithdrawFlow() {
  return (
    <DiagramFrame
      title="BTC withdrawal — the program authorises, the network signs"
      note="no single key can move a vault UTXO"
      viewBox="0 0 1000 730"
      minWidth={960}
      legend={[
        { tone: "sol", label: "Solana" },
        { tone: "ika", label: "Ika" },
        { tone: "btc", label: "Bitcoin" },
      ]}
    >
      <Lifeline x={WCOL.wallet} y={14} h={700} label="User wallet" sub="proves the spend" />
      <Lifeline x={WCOL.prog} y={14} h={700} label="utxopia" sub="asset program" tone="sol" />
      <Lifeline x={WCOL.be} y={14} h={700} label="Redemption svc" sub="builds the BTC tx" />
      <Lifeline x={WCOL.ika} y={14} h={700} label="Ika" sub="dWallet + MPC network" tone="ika" />
      <Lifeline x={WCOL.btc} y={14} h={700} label="Bitcoin L1" sub="payout tx" tone="btc" />

      <Msg
        n={1}
        from={WCOL.wallet}
        to={WCOL.prog}
        y={100}
        tone="sol"
        label="redeem — JoinSplit proof + BTC destination"
        sub="zkBTC escrowed, RedemptionRequest PDA opened"
      />
      <Msg n={2} from={WCOL.prog} to={WCOL.be} y={146} dashed label="request detected" sub="PDA scanner / log watcher" />
      <Msg
        n={3}
        from={WCOL.be}
        to={WCOL.prog}
        y={192}
        tone="sol"
        label="mark_processing"
        sub={'reserves UtxoRecord ["utxo", pool_state, txid, vout]'}
      />
      <SelfMsg
        n={4}
        x={WCOL.be}
        y={244}
        w={290}
        label="build the unsigned transaction"
        sub="inputs = reserved UTXOs; BIP-341 key-spend sighash"
      />
      <Msg
        n={5}
        from={WCOL.be}
        to={WCOL.prog}
        y={296}
        tone="sol"
        label="approve_redemption_signing"
        sub="sighash, digest, miner_fee, input_index"
      />
      <SelfMsg
        n={6}
        x={WCOL.prog}
        y={348}
        w={300}
        tone="sol"
        label="rebuild the sighash on chain"
        sub="from reserved UTXOs + recipient script; mismatch aborts"
      />
      <Msg
        n={7}
        from={WCOL.prog}
        to={WCOL.ika}
        y={400}
        tone="ika"
        label="CPI approve_message"
        sub={'signed by ["__ika_cpi_authority"], Taproot/Schnorr'}
      />
      <SelfMsg
        n={8}
        x={WCOL.ika}
        y={452}
        w={300}
        side="left"
        tone="ika"
        label="MessageApproval PDA created"
        sub="only if dWallet.authority == that CPI authority"
      />
      <SelfMsg
        n={9}
        x={WCOL.ika}
        y={504}
        w={300}
        side="left"
        tone="ika"
        label="threshold network signs"
        sub="2PC-MPC — no node holds the key"
      />
      <Msg n={10} from={WCOL.ika} to={WCOL.be} y={556} dashed tone="ika" label="signature" sub="polled from the Sign account" />
      <Msg n={11} from={WCOL.be} to={WCOL.btc} y={602} tone="btc" label="attach witness, broadcast" />
      <Msg n={12} from={WCOL.btc} to={WCOL.prog} y={648} dashed tone="btc" label="payout SPV-verified" sub="via btc-light-client" />
      <Msg
        n={13}
        from={WCOL.be}
        to={WCOL.prog}
        y={690}
        tone="sol"
        label="complete_redemption"
        sub="burn zkBTC, close reserved records, book the change UTXO"
      />
    </DiagramFrame>
  );
}
