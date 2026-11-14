"use client";
import { NearConnector } from "@hot-labs/near-connect";
import { fromHotConnect, Near } from "near-kit";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CONTRACT, NETWORK } from "../lib/kennel";
import { DotAvatar } from "./ascii";

type Wallet = {
  accountId: string | null;
  connect: () => void;
  disconnect: () => void;
  /** Sign a call to the Kennel contract with the connected wallet. Returns the tx hash. */
  call: (method: string, args: object, opts?: { deposit?: string; gas?: string }) => Promise<string | undefined>;
  /** Sign one transaction with several function calls to `receiver` (e.g. wrap + swap). */
  send: (receiver: string, calls: { method: string; args: object; deposit?: string; gas?: string }[]) => Promise<void>;
};

const Ctx = createContext<Wallet>({
  accountId: null,
  connect: () => {},
  disconnect: () => {},
  call: async () => undefined,
  send: async () => {},
});

export const useWallet = () => useContext(Ctx);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const connector = useRef<NearConnector | null>(null);
  const near = useRef<Near | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    const c = new NearConnector({ network: NETWORK, autoConnect: true, footerBranding: null });
    connector.current = c;
    const signedIn = (accounts: { accountId: string }[]) => {
      const id = accounts[0]?.accountId ?? null;
      setAccountId(id);
      near.current = id ? new Near({ network: NETWORK, wallet: fromHotConnect(c) }) : null;
    };
    c.on("wallet:signIn", (e) => signedIn(e.accounts));
    c.on("wallet:signOut", () => signedIn([]));
    c.getConnectedWallet().then((w) => signedIn(w.accounts)).catch(() => {});
    return () => c.removeAllListeners();
  }, []);

  const connect = useCallback(() => {
    connector.current?.connect().catch(() => {});
  }, []);
  const disconnect = useCallback(() => {
    connector.current?.disconnect().catch(() => {});
  }, []);

  const call = useCallback<Wallet["call"]>(
    async (method, args, opts = {}) => {
      if (!near.current || !accountId) {
        connect();
        throw new Error("Connect a wallet first");
      }
      const outcome = (await near.current.call(CONTRACT, method, args, {
        signerId: accountId,
        // near-kit types these as template-literal unions; the values are validated at runtime.
        gas: (opts.gas ?? "300 Tgas") as never,
        attachedDeposit: (opts.deposit ?? "0 NEAR") as never,
      })) as { transaction?: { hash?: string } } | undefined;
      return outcome?.transaction?.hash;
    },
    [accountId, connect],
  );

  const send = useCallback<Wallet["send"]>(
    async (receiver, calls) => {
      if (!near.current || !accountId) {
        connect();
        throw new Error("Connect a wallet first");
      }
      let tx = near.current.transaction(accountId);
      for (const c of calls) {
        tx = tx.functionCall(receiver, c.method, c.args, {
          gas: (c.gas ?? "100 Tgas") as never,
          attachedDeposit: (c.deposit ?? "0 NEAR") as never,
        });
      }
      await tx.send();
    },
    [accountId, connect],
  );

  return <Ctx.Provider value={{ accountId, connect, disconnect, call, send }}>{children}</Ctx.Provider>;
}

export function ConnectButton() {
  const { accountId, connect, disconnect } = useWallet();
  if (!accountId) {
    return <button className="btn" onClick={connect}>Connect wallet</button>;
  }
  return (
    <span style={{ display: "inline-flex" }}>
      <Link href={`/u/${accountId}`} className="btn ghost" title="Your profile">
        <DotAvatar id={accountId} size={18} /> {accountId.length > 22 ? `${accountId.slice(0, 18)}…` : accountId}
      </Link>
      <button className="btn ghost" onClick={disconnect} title="Disconnect" aria-label="Disconnect" style={{ borderLeft: 0 }}>×</button>
    </span>
  );
}
