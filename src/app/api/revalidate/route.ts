import { revalidateTag } from "next/cache";

export async function POST() {
  revalidateTag("time", { expire: 0 });
  return Response.json({ revalidated: "time" });
}
