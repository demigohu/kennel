import { redirect } from "next/navigation";

export default async function Legacy({ params }: { params: Promise<{ symbol: string }> }) {
  redirect(`/coin/${(await params).symbol}`);
}
