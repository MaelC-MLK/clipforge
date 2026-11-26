import { requireUser } from "@/lib/auth";
import { listLibrary } from "@/lib/storage";
import { Library } from "../library";

export default async function VideosPage() {
  const user = await requireUser();
  return <Library view="videos" initial={await listLibrary(user.id)} />;
}
