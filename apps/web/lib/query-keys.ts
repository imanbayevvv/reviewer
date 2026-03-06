export const queryKeys = {
  me: ['me'] as const,
  shops: ['shops'] as const,
  shop: (id: string) => ['shops', id] as const,
  shopAnalysis: (id: string) => ['shops', id, 'analysis'] as const,
  themes: ['themes'] as const,
  products: (shopId: string) => ['shops', shopId, 'products'] as const,
  product: (shopId: string, id: string) => ['shops', shopId, 'products', id] as const,
  reviewJobs: (snapshotId?: string) => ['review-jobs', snapshotId] as const,
  reviewJob: (id: string) => ['review-jobs', id] as const,
};
