export interface EvalCase {
  label: string;
  question: string;
  expectedQuery: string;
  outputQuery: string;
  raw: unknown;
}

export interface ResultsCase {
  id: string;
  question: string;
  golden: string;
  generated: string;
  [key: string]: unknown;
}