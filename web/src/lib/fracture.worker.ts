import {
  computeFragments,
  computeSlice,
  type FractureRequest,
  type FractureResponse,
  type SliceRequest,
} from "./fracture-core";

self.onmessage = async (e: MessageEvent<FractureRequest | SliceRequest>) => {
  try {
    const req = e.data;
    const res: FractureResponse = "op" in req && req.op === "slice" ? await computeSlice(req) : await computeFragments(req as FractureRequest);
    // Fragments can share underlying buffers; list each one once.
    const transfer = new Set<ArrayBuffer>();
    for (const f of res.fragments) {
      for (const a of [f.position, f.normal, f.uv, f.index]) transfer.add(a.buffer as ArrayBuffer);
    }
    (self as unknown as Worker).postMessage({ ok: true, res }, [...transfer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
