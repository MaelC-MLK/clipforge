import { requireUser } from "@/lib/auth";
import { listLibrary } from "@/lib/storage";
import { Library } from "./library";

export default async function LibraryPage() {
  const user = await requireUser();
  return <Library initial={await listLibrary(user.id)} />;
}
