export type Report = {
  row_count: number
  column_count: number
  missing_cells: number
  duplicate_rows: number
  quality_score: number
  column_stats: Record<string, { type?: string; missing?: number; unique?: number; min?: number; max?: number; mean?: number }>
  warnings: string[]
}

export type DatasetReport = {
  file_id: string
  status: 'UPLOADED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  original_filename: string
  report?: Report
  error?: string
}

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.VITE_API_BASE_URL || ''

function apiUrl(path: string) {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

export async function uploadDataset(file: File, onStatus?: (status: string) => void): Promise<DatasetReport> {
  if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('Please choose a CSV file.')
  if (file.size > 5 * 1024 * 1024) throw new Error('CSV files must be smaller than 5 MB.')

  const urlResponse = await fetch(apiUrl('/upload-url'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name }),
  })
  if (!urlResponse.ok) throw new Error('Could not create an upload URL.')
  const { upload_url, file_id } = await urlResponse.json()
  const uploadResponse = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/csv' }, body: file })
  if (!uploadResponse.ok) throw new Error('The CSV upload failed.')

  onStatus?.('UPLOADED')
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const reportResponse = await fetch(apiUrl(`/report?file_id=${encodeURIComponent(file_id)}`))
    if (!reportResponse.ok) throw new Error('Could not retrieve the analysis report.')
    const result = (await reportResponse.json()) as DatasetReport
    onStatus?.(result.status)
    if (result.status === 'COMPLETED' || result.status === 'FAILED') return result
  }
  throw new Error('Analysis is taking longer than expected. Please try again later.')
}
