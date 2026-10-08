export interface ResultsCase {
    dataset: string;
    system_name?: string;
    metrics?: Record<string, number>;
    per_query_results?: PerQueryResult[];
}

export interface PerQueryResult {
    id: string;
    metric: string;
    score: number;
}