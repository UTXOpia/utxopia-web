/** Diagrams for the /architecture/magicblock page. */

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

/* ── 1. what is delegated ── */

export function DelegationBoundary() {
  return (
    <DiagramFrame
      title="The delegation boundary"
      note="one account crosses it, and it comes back"
      viewBox="0 0 1000 370"
      minWidth={880}
      legend={[
        { tone: "sol", label: "always on Solana" },
        { tone: "er", label: "delegated to the rollup" },
      ]}
    >
      <Lane x={24} y={20} w={456} h={300} label="Never delegated" tone="sol" />
      {[
        ["Notes & commitment tree", "every leaf, every root"],
        ["Nullifiers", "the double-spend record"],
        ["zkBTC supply & vault", "mint, burn, accounting"],
        ["Ika dWallet & BTC UTXOs", "custody never moves"],
      ].map(([t, s], i) => (
        <Box
          key={t}
          x={42}
          y={54 + i * 64}
          w={420}
          h={52}
          tone="sol"
          title={t}
          lines={[s]}
        />
      ))}

      <Lane x={520} y={20} w={456} h={300} label="Delegated, briefly" tone="er" />
      <Box
        x={538}
        y={54}
        w={420}
        h={130}
        tone="er"
        title="PolicyApproval PDA"
        tag="176 bytes"
        lines={[
          "one action · one actor · one use",
          "seeds: pool_state | request_hash | nonce",
          "status: Pending → Approved | Rejected",
          "expires at a fixed Solana slot",
          "owned by the utxopia-policy program",
        ]}
      />
      <Note
        x={538}
        y={214}
        tone="er"
        lines={[
          "It carries no amount, no note and no",
          "destination — only a hash of them. Delegating",
          "it moves a decision, never an asset.",
        ]}
      />
      <Arrow d="M 538 300 L 958 300" tone="er" dashed />
      <Note x={748} y={292} anchor="middle" lines={["delegate → decide → commit back"]} />
    </DiagramFrame>
  );
}

/* ── 2. lifecycle ── */

const C = { client: 80, coord: 320, sol: 600, er: 880 };

export function Lifecycle() {
  return (
    <DiagramFrame
      title="The approval lifecycle"
      note="both verdicts take exactly this path"
      viewBox="0 0 1000 660"
      minWidth={960}
      legend={[
        { tone: "er", label: "MagicBlock / PER" },
        { tone: "sol", label: "Solana base layer" },
      ]}
    >
      <Lifeline x={C.client} y={14} h={610} label="Client" sub="wallet or relayer" />
      <Lifeline x={C.coord} y={14} h={610} label="Policy coordinator" sub="TDX enclave" tone="er" />
      <Lifeline x={C.sol} y={14} h={610} label="Solana" sub="policy + asset programs" tone="sol" />
      <Lifeline x={C.er} y={14} h={610} label="MagicBlock ER" sub="PER, TEE validator" tone="er" />

      <Msg n={1} from={C.client} to={C.coord} y={100} label="request approval" sub="actor, member, action, intent parts" />
      <SelfMsg
        n={2}
        x={C.coord}
        y={150}
        w={250}
        tone="er"
        label="screen the destination"
        sub="fails closed — an unreadable list refuses"
      />
      <Msg
        n={3}
        from={C.coord}
        to={C.sol}
        y={204}
        tone="sol"
        label="initialize_policy_approval"
        sub="status Pending, expires_at_slot set"
      />
      <Msg
        n={4}
        from={C.coord}
        to={C.sol}
        y={250}
        tone="sol"
        label="magicblock_delegate"
        sub="this one account, validator pinned to the TEE"
      />
      <Msg
        n={5}
        from={C.coord}
        to={C.er}
        y={296}
        tone="er"
        label="create PER permission"
        sub="private, ≤ 8 members, one authority retained"
      />
      <Msg
        n={6}
        from={C.coord}
        to={C.er}
        y={342}
        tone="er"
        label="policy_approval_decision(approve | reject)"
        sub="the verdict is applied inside the enclave"
      />
      <Msg
        n={7}
        from={C.coord}
        to={C.er}
        y={388}
        tone="er"
        label="close permission, commit_and_undelegate"
      />
      <Msg
        n={8}
        from={C.er}
        to={C.sol}
        y={434}
        tone="sol"
        label="account lands back on Solana"
        sub="status now Approved or Rejected"
      />
      <Msg n={9} from={C.coord} to={C.client} y={480} dashed label="approval account" sub="the reason for a refusal never leaves the enclave" />
      <Msg
        n={10}
        from={C.client}
        to={C.sol}
        y={526}
        tone="sol"
        label="transact / unshield / redeem — approval attached"
      />
      <SelfMsg
        n={11}
        x={C.sol}
        y={578}
        w={300}
        side="left"
        tone="sol"
        label="consume_policy_approval"
        sub="recompute the hash, check the slot, CPI → Consumed"
      />
    </DiagramFrame>
  );
}

/* ── 3. intent binding ── */

export function IntentBinding() {
  return (
    <DiagramFrame
      title="What the approval actually commits to"
      note="the intent, not the transaction bytes"
      viewBox="0 0 1000 300"
      minWidth={900}
    >
      <Box
        x={24}
        y={30}
        w={300}
        h={160}
        tone="zk"
        title="Intent parts"
        lines={[
          "transact / unshield:",
          "\u00a0\u00a0nullifiers ‖ amounts ‖ destinations",
          "redeem:",
          "\u00a0\u00a0nullifiers ‖ amount ‖ scriptPubKey",
          "deposit / shield:",
          "\u00a0\u00a0the whole payload, one part",
        ]}
      />
      <Arrow d="M 324 110 L 358 110" tone="zk" />
      <Box
        x={358}
        y={30}
        w={300}
        h={160}
        tone="zk"
        title="Fold, then hash"
        lines={[
          "each part → 32 bytes first, so the",
          "boundaries cannot be slid",
          "",
          "request_hash = H(domain, program,",
          "\u00a0\u00a0pool, actor, action, folded parts)",
        ]}
      />
      <Arrow d="M 658 110 L 692 110" tone="zk" />
      <Box
        x={692}
        y={30}
        w={284}
        h={160}
        tone="sol"
        title="Bound both ways"
        lines={[
          "PDA seeds carry request_hash",
          "+ a random nonce",
          "",
          "the asset program recomputes it",
          "and refuses on any difference",
        ]}
      />
      <Note
        x={24}
        y={222}
        lines={[
          "Why not bind the whole instruction: a spend must be re-proved whenever the merkle root moves on — which is",
          "precisely while the authority is deciding. Binding the payload would expire every approval against a live pool.",
          "Binding the intent survives the re-proof and still pins which notes are spent, how much leaves, and where it goes.",
        ]}
      />
    </DiagramFrame>
  );
}

/* ── 4. consumption checks ── */

export function ConsumptionChecks() {
  return (
    <DiagramFrame
      title="What has to hold at consumption"
      note="all five, inside the same transaction"
      viewBox="0 0 1000 320"
      minWidth={900}
    >
      <Box
        x={330}
        y={16}
        w={340}
        h={50}
        tone="sol"
        center
        title="Asset instruction arrives with an approval"
      />
      {[
        ["Ownership", ["owned by the policy", "program, and writable"]],
        ["request_hash", ["recomputed from this", "exact intent"]],
        ["Actor & authority", ["match the approval and", "the pool's auditor"]],
        ["Status", ["Approved — never", "Pending or Consumed"]],
        ["Slot", ["current slot is before", "expires_at_slot"]],
      ].map(([t, lines], i) => {
        const x = 24 + i * 190;
        return (
          <g key={t as string}>
            <Arrow d={`M 500 66 L 500 92 L ${x + 88} 92 L ${x + 88} 128`} tone="sol" />
            <Box
              x={x}
              y={128}
              w={176}
              h={76}
              tone="sol"
              title={t as string}
              lines={lines as string[]}
            />
          </g>
        );
      })}
      <Lane x={24} y={228} w={936} h={72} label="On any failure" />
      <Note
        x={44}
        y={266}
        lines={[
          "The transaction reverts whole — the approval is not marked Consumed, no nullifier is created, no leaf is appended.",
          "A refused spender still exits to their pre-registered destination via ragequit, which needs no approval at all.",
        ]}
      />
    </DiagramFrame>
  );
}

/* ── 5. attestation ── */

export function AttestationChain() {
  return (
    <DiagramFrame
      title="Why the enclave is trusted at all"
      note="a hostname is not a TEE"
      viewBox="0 0 1000 130"
      minWidth={860}
    >
      {[
        ["PER endpoint", ["challenged with 64", "random bytes"]],
        ["TDX quote", ["signed by the", "platform"]],
        ["DCAP collateral", ["fetched from the", "Phala PCCS"]],
        ["MRTD + RTMRs", ["pinned — this is which", "code is inside"]],
        ["TCB status", ["UpToDate or", "SWHardeningNeeded"]],
      ].map(([t, lines], i) => {
        const x = 20 + i * 196;
        return (
          <g key={t as string}>
            <Box x={x} y={20} w={176} h={76} tone="er" title={t as string} lines={lines as string[]} />
            {i < 4 && <Arrow d={`M ${x + 176} 58 L ${x + 196} 58`} tone="er" />}
          </g>
        );
      })}
    </DiagramFrame>
  );
}
