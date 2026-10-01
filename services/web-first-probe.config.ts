export const WEB_FIRST_PROBE_TOP_K = parseInt(
  process.env.WEB_FIRST_PROBE_TOP_K ?? '3',
  10,
);

export const WEB_FIRST_PROBE_SIMILARITY_THRESHOLD = parseFloat(
  process.env.WEB_FIRST_PROBE_SIMILARITY_THRESHOLD ?? '0.4',
);

export const WEB_FIRST_PROBE_MIN_CHUNKS = parseInt(
  process.env.WEB_FIRST_PROBE_MIN_CHUNKS ?? '2',
  10,
);
