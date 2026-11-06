import { Suspense } from "react";
import PlayView from "./PlayView";

export default function Page(props: PageProps<"/jobs/[id]/play">) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
      <PlayLoader params={props.params} />
    </Suspense>
  );
}

async function PlayLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlayView id={id} />;
}
