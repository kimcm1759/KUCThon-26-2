import { Suspense } from "react";
import JobView from "./JobView";

export default function Page(props: PageProps<"/jobs/[id]">) {
  return (
    <Suspense fallback={<p className="p-6 text-neutral-400">불러오는 중…</p>}>
      <JobLoader params={props.params} />
    </Suspense>
  );
}

async function JobLoader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JobView id={id} />;
}
