import { notFound } from "next/navigation";
import { gameIdPattern } from "@/lib/play";
import Room from "./room";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!gameIdPattern.test(id)) notFound();
  return <Room id={id} />;
}
