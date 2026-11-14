import { redirect } from "next/navigation";

export default async function Legacy({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/u/${(await params).id}`);
}
