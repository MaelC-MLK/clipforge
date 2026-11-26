import { requireUser } from "@/lib/auth";
import { listLibrary } from "@/lib/storage";
import { Library } from "../library";

export default async function SourcesPage() {
  const user = await requireUser();
  return <Library view="sources" initial={await listLibrary(user.id)} />;
}
