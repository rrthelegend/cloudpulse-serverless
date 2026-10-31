'use client'

import { useMemo, useRef, useState } from 'react'
import type { ComponentType, ChangeEvent, DragEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  Database,
  Download,
  FileBarChart,
  FileText,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
  UploadCloud,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { uploadDataset, type DatasetReport } from '@/lib/api'

type View = 'overview' | 'analysis' | 'history'

type DistributionBin = {
  label?: string
  bin?: string
  start?: number
  end?: number
  frequency?: number
  count?: number
}

type ColumnProfile = {
  type?: string
  detected_type?: string
  missing?: number
  missing_count?: number
  missing_percentage?: number
  non_empty_count?: number
  unique?: number
  min?: number
  max?: number
  minimum?: number
  maximum?: number
  mean?: number
  median?: number
  std_dev?: number
  distribution?: DistributionBin[]
}

type QualityDimensions = {
  completeness?: number
  uniqueness?: number
  validity?: number
  consistency?: number
}

type LocalReport = {
  row_count?: number
  column_count?: number
  complete_rows?: number
  missing_cells?: number
  duplicate_rows?: number
  quality_score?: number
  quality_dimensions?: QualityDimensions
  column_stats?: Record<string, ColumnProfile>
  numeric_columns?: string[] | number
  categorical_columns?: string[] | number
  validation_issue_count?: number
  inconsistent_rows?: number
  warnings?: string[]
}

type DatasetWithLocalReport = Omit<DatasetReport, 'report'> & {
  report?: LocalReport
}

const navItems = [
  { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
  { id: 'analysis' as const, label: 'Dataset analysis', icon: BarChart3 },
  { id: 'history' as const, label: 'Dataset history', icon: History },
]

const numberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const fmt = (value: unknown): string =>
  numberValue(value) == null ? '—' : numberValue(value)!.toLocaleString()

const pct = (value: unknown): string => {
  const number = numberValue(value)
  return number == null ? '—' : `${number.toFixed(1)}%`
}

function getReport(dataset: DatasetReport): LocalReport | undefined {
  return (dataset as DatasetWithLocalReport).report
}

function getMissing(stats: ColumnProfile): number {
  return numberValue(stats.missing) ?? numberValue(stats.missing_count) ?? 0
}

function getType(stats: ColumnProfile): string {
  return stats.type ?? stats.detected_type ?? 'unknown'
}

function isNumericColumn(stats: ColumnProfile): boolean {
  const type = getType(stats).toLowerCase()
  return (
    ['numeric', 'integer', 'int', 'float', 'number'].some((part) =>
      type.includes(part),
    ) ||
    [
      stats.min,
      stats.max,
      stats.minimum,
      stats.maximum,
      stats.mean,
      stats.median,
    ].some((value) => numberValue(value) != null)
  )
}

function getNumericNames(report: LocalReport): string[] {
  const supplied = report.numeric_columns
  if (Array.isArray(supplied)) {
    const validNames = supplied.filter(
      (name): name is string => typeof name === 'string',
    )
    if (validNames.length > 0) return validNames
  }

  return Object.entries(report.column_stats ?? {})
    .filter(([, stats]) => isNumericColumn(stats))
    .map(([name]) => name)
}

function getCategoryCount(report: LocalReport): number {
  const supplied = report.categorical_columns
  if (Array.isArray(supplied)) return supplied.length
  if (numberValue(supplied) != null) return numberValue(supplied)!

  const numeric = new Set(getNumericNames(report))
  return Object.keys(report.column_stats ?? {}).filter(
    (name) => !numeric.has(name),
  ).length
}

function getMin(stats: ColumnProfile): number | undefined {
  return numberValue(stats.min) ?? numberValue(stats.minimum)
}

function getMax(stats: ColumnProfile): number | undefined {
  return numberValue(stats.max) ?? numberValue(stats.maximum)
}

function getDistribution(stats?: ColumnProfile) {
  return (stats?.distribution ?? []).map((item, index) => ({
    label:
      item.label ??
      item.bin ??
      (item.start != null && item.end != null
        ? `${item.start}–${item.end}`
        : `Bin ${index + 1}`),
    frequency: numberValue(item.frequency) ?? numberValue(item.count) ?? 0,
  }))
}

function StatusPill({ status }: { status: string }) {
  const styles =
    status === 'COMPLETED'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      : status === 'FAILED'
        ? 'border-rose-400/20 bg-rose-400/10 text-rose-300'
        : 'border-amber-400/20 bg-amber-400/10 text-amber-300'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide ${styles}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {status.toLowerCase()}
    </span>
  )
}

function UploadCard({
  onComplete,
}: {
  onComplete: (result: DatasetReport) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const process = async (file?: File) => {
    if (!file) return
    setError('')
    setStatus('PROCESSING')
    try {
      const result = await uploadDataset(file, setStatus)
      onComplete(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setStatus('')
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void process(event.dataTransfer.files[0])
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    void process(event.target.files?.[0])
    event.target.value = ''
  }

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border border-dashed ${
        dragging
          ? 'border-indigo-400 bg-indigo-400/10'
          : 'border-indigo-300/20 bg-gradient-to-br from-indigo-500/[0.09] via-white/[0.025] to-violet-500/[0.06]'
      } p-10 shadow-2xl shadow-indigo-950/20 transition-colors sm:p-14`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="relative flex flex-col items-center text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-indigo-400/20 bg-indigo-400/10 text-indigo-300">
          <UploadCloud className="size-6" />
        </div>
        <h3 className="text-base font-semibold text-white">Drop your CSV here</h3>
        <p className="mt-1 text-sm text-slate-400">
          or select a file from your computer
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={Boolean(status)}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          {status ? `${status.toLowerCase()}…` : 'Choose CSV file'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleChange}
        />
        <p className="mt-4 text-[11px] text-slate-500">
          CSV only · max 5 MB · your data stays private
        </p>
        {error && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-rose-300">
            <X className="size-3" />
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent = 'text-indigo-300',
}: {
  label: string
  value: string
  icon: ComponentType<{ className?: string }>
  accent?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        <Icon className={`size-4 ${accent}`} />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-white">
        {value}
      </p>
    </div>
  )
}

function QualityBreakdown({ report }: { report: LocalReport }) {
  const dimensions = [
    { label: 'Completeness', value: report.quality_dimensions?.completeness },
    { label: 'Uniqueness', value: report.quality_dimensions?.uniqueness },
    { label: 'Validity', value: report.quality_dimensions?.validity },
    { label: 'Consistency', value: report.quality_dimensions?.consistency },
  ]

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <div className="mb-5">
        <h2 className="font-medium text-white">Data quality breakdown</h2>
        <p className="mt-1 text-xs text-slate-500">
          Dimension scores from the analysis report
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {dimensions.map((item) => {
          const value = numberValue(item.value)
          return (
            <div key={item.label}>
              <div className="mb-2 flex justify-between text-xs">
                <span className="text-slate-400">{item.label}</span>
                <span className="font-medium text-white">{pct(value)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-400"
                  style={{
                    width: `${Math.min(100, Math.max(0, value ?? 0))}%`,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <div className="mb-4">
        <h2 className="font-medium text-white">{title}</h2>
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      </div>
      {children}
    </section>
  )
}

function ReportCharts({ report }: { report: LocalReport }) {
  const stats = report.column_stats ?? {}
  const columns = Object.entries(stats)
  const numericNames = getNumericNames(report)
  const [selected, setSelected] = useState(numericNames[0] ?? '')

  const activeSelected = numericNames.includes(selected)
    ? selected
    : numericNames[0] ?? ''

  const missing = columns
    .map(([name, value]) => ({ name, missing: getMissing(value) }))
    .sort((a, b) => b.missing - a.missing)
    .slice(0, 12)

  const distribution = getDistribution(stats[activeSelected])

  const typeData = [
    { name: 'Numeric', value: numericNames.length },
    { name: 'Categorical', value: getCategoryCount(report) },
  ].filter((item) => item.value > 0)

  const issueData = [
    { name: 'Missing cells', value: numberValue(report.missing_cells) ?? 0 },
    { name: 'Duplicate rows', value: numberValue(report.duplicate_rows) ?? 0 },
    {
      name: 'Invalid values',
      value: numberValue(report.validation_issue_count) ?? 0,
    },
    {
      name: 'Inconsistent rows',
      value: numberValue(report.inconsistent_rows) ?? 0,
    },
  ]

  const colors = ['#818cf8', '#a78bfa', '#34d399', '#fbbf24']

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard
        title="Missing values by column"
        subtitle="Count of empty cells in each field"
      >
        <div className="h-72">
          {columns.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={missing}
                layout="vertical"
                margin={{ left: 12, right: 16 }}
              >
                <CartesianGrid stroke="#ffffff12" horizontal={false} />
                <XAxis type="number" stroke="#64748b" fontSize={11} />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={90}
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: '#121827',
                    border: '1px solid #ffffff1a',
                    borderRadius: 10,
                    color: '#fff',
                  }}
                />
                <Bar dataKey="missing" fill="#818cf8" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="No column statistics returned." />
          )}
        </div>
      </ChartCard>

      <ChartCard
        title="Numeric distributions"
        subtitle="Frequency by report-provided histogram bin"
      >
        {numericNames.length > 0 ? (
          <>
            <label
              htmlFor="numeric-column-select"
              className="mb-3 block text-xs text-slate-400"
            >
              Select a numeric column
            </label>
            <select
              id="numeric-column-select"
              value={activeSelected}
              onChange={(event) => setSelected(event.target.value)}
              className="mb-3 w-full rounded-lg border border-white/10 bg-[#111827] px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-400"
            >
              {numericNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <div className="h-56">
              {distribution.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distribution}>
                    <CartesianGrid stroke="#ffffff12" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="#64748b"
                      fontSize={10}
                      tickLine={false}
                    />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: '#121827',
                        border: '1px solid #ffffff1a',
                        borderRadius: 10,
                        color: '#fff',
                      }}
                    />
                    <Bar
                      dataKey="frequency"
                      fill="#a78bfa"
                      radius={[5, 5, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart message="No histogram data was returned for this column." />
              )}
            </div>
          </>
        ) : (
          <EmptyChart message="No numeric columns were detected." />
        )}
      </ChartCard>

      <ChartCard
        title="Column type distribution"
        subtitle="Numeric versus categorical columns"
      >
        <div className="h-72">
          {typeData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={typeData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={65}
                  outerRadius={95}
                  paddingAngle={4}
                >
                  {typeData.map((item, index) => (
                    <Cell
                      key={item.name}
                      fill={colors[index % colors.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#121827',
                    border: '1px solid #ffffff1a',
                    borderRadius: 10,
                    color: '#fff',
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="No column type information available." />
          )}
        </div>
      </ChartCard>

      <ChartCard
        title="Data quality issues"
        subtitle="Counts of detected quality issues"
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={issueData} margin={{ bottom: 18 }}>
              <CartesianGrid stroke="#ffffff12" vertical={false} />
              <XAxis
                dataKey="name"
                stroke="#64748b"
                fontSize={10}
                interval={0}
                angle={-12}
                textAnchor="end"
                height={55}
              />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip
                contentStyle={{
                  background: '#121827',
                  border: '1px solid #ffffff1a',
                  borderRadius: 10,
                  color: '#fff',
                }}
              />
              <Bar dataKey="value" fill="#818cf8" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-white/10 px-4 text-center text-sm text-slate-500">
      {message}
    </div>
  )
}

function Insights({ report }: { report: LocalReport }) {
  const columns = Object.entries(report.column_stats ?? {})
  const missing = columns.filter(([, stats]) => getMissing(stats) > 0)
  const invalid = numberValue(report.validation_issue_count) ?? 0
  const duplicate = numberValue(report.duplicate_rows) ?? 0
  const inconsistent = numberValue(report.inconsistent_rows) ?? 0
  const numeric = getNumericNames(report)

  const items = [
    {
      tone: 'amber',
      icon: AlertTriangle,
      title: missing.length
        ? `${missing.length} column${missing.length > 1 ? 's' : ''} contain missing values`
        : 'No missing values detected',
      body: missing.length
        ? `${missing
            .slice(0, 3)
            .map(([name, stats]) => `${name} (${fmt(getMissing(stats))})`)
            .join(', ')}${missing.length > 3 ? ' and more' : ''}. Review source completeness before modeling.`
        : 'All analyzed columns are complete.',
    },
    {
      tone: 'violet',
      icon: FileBarChart,
      title: duplicate
        ? `${fmt(duplicate)} duplicate rows found`
        : 'No duplicate rows detected',
      body: duplicate
        ? 'Deduplicate records or confirm that repeated events are expected.'
        : 'The dataset contains no repeated records according to the report.',
    },
    {
      tone: 'rose',
      icon: ShieldCheck,
      title: invalid
        ? `${fmt(invalid)} validation issues require review`
        : 'No validation issues detected',
      body: invalid
        ? 'Inspect invalid values before using this dataset in downstream workflows.'
        : 'No validation issues were reported.',
    },
    {
      tone: 'indigo',
      icon: BarChart3,
      title: inconsistent
        ? `${fmt(inconsistent)} inconsistent rows identified`
        : 'No inconsistent rows detected',
      body: inconsistent
        ? 'Check the affected CSV rows and standardize their structure.'
        : numeric.length
          ? `Numeric profiles are available for ${numeric.length} column${numeric.length > 1 ? 's' : ''}. Review their ranges against domain expectations.`
          : 'No numeric distribution signals were available.',
    },
  ]

  const toneClasses: Record<string, string> = {
    amber: 'bg-amber-400/10 text-amber-300',
    violet: 'bg-violet-400/10 text-violet-300',
    rose: 'bg-rose-400/10 text-rose-300',
    indigo: 'bg-indigo-400/10 text-indigo-300',
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="font-medium text-white">Insights & recommendations</h2>
        <p className="mt-1 text-xs text-slate-500">
          Automated findings based on this report
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map(({ tone, icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-xl border border-white/10 bg-white/[0.025] p-4"
          >
            <div className="flex gap-3">
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${toneClasses[tone]}`}
              >
                <Icon className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-slate-200">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">{body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ColumnTable({ report }: { report: LocalReport }) {
  const entries = Object.entries(report.column_stats ?? {})

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
      <h2 className="font-medium text-white">Column statistics</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[850px] text-left text-sm">
          <thead className="border-b border-white/10 text-xs text-slate-500">
            <tr>
              {[
                'Column',
                'Type',
                'Missing',
                'Missing %',
                'Unique',
                'Minimum',
                'Maximum',
                'Mean',
                'Median',
              ].map((heading) => (
                <th key={heading} className="pb-3 pr-4 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {entries.map(([name, stats]) => {
              const type = getType(stats)
              const numeric = isNumericColumn(stats)
              return (
                <tr key={name} className="text-slate-300">
                  <td className="py-3 pr-4 font-medium text-white">{name}</td>
                  <td className="py-3 pr-4 text-indigo-300">{type}</td>
                  <td className="py-3 pr-4">{fmt(getMissing(stats))}</td>
                  <td className="py-3 pr-4">{pct(stats.missing_percentage)}</td>
                  <td className="py-3 pr-4">{fmt(stats.unique)}</td>
                  <td className="py-3 pr-4">{numeric ? fmt(getMin(stats)) : '—'}</td>
                  <td className="py-3 pr-4">{numeric ? fmt(getMax(stats)) : '—'}</td>
                  <td className="py-3 pr-4">{numeric ? fmt(stats.mean) : '—'}</td>
                  <td className="py-3 pr-4">{numeric ? fmt(stats.median) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {entries.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            No column statistics were returned.
          </p>
        )}
      </div>
    </section>
  )
}

function Analysis({
  dataset,
  onBack,
}: {
  dataset: DatasetReport
  onBack: () => void
}) {
  const report = getReport(dataset)

  if (!report) {
    return (
      <div className="rounded-2xl border border-white/10 p-8 text-slate-400">
        No report data returned.
      </div>
    )
  }

  const download = () => {
    const blob = new Blob([JSON.stringify(dataset, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${dataset.original_filename.replace(/\.csv$/i, '')}-report.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-slate-500 hover:text-white"
      >
        ← Back to overview
      </button>

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-white">
              {dataset.original_filename}
            </h1>
            <StatusPill status={dataset.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Analysis report · {dataset.file_id}
          </p>
        </div>
        <button
          type="button"
          onClick={download}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5"
        >
          <Download className="size-4" />
          Download JSON
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Quality score"
          value={pct(report.quality_score)}
          icon={ShieldCheck}
          accent="text-emerald-300"
        />
        <StatCard label="Total rows" value={fmt(report.row_count)} icon={BarChart3} />
        <StatCard label="Total columns" value={fmt(report.column_count)} icon={Database} />
        <StatCard
          label="Missing cells"
          value={fmt(report.missing_cells)}
          icon={AlertTriangle}
          accent="text-amber-300"
        />
        <StatCard
          label="Duplicate rows"
          value={fmt(report.duplicate_rows)}
          icon={FileBarChart}
          accent="text-violet-300"
        />
        <StatCard
          label="Complete rows"
          value={fmt(report.complete_rows)}
          icon={Check}
          accent="text-emerald-300"
        />
      </div>

      <QualityBreakdown report={report} />
      <ReportCharts report={report} />
      <Insights report={report} />
      <ColumnTable report={report} />

      <section className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.04] p-5">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-300" />
          <h2 className="font-medium text-white">Warnings</h2>
        </div>
        {report.warnings?.length ? (
          <ul className="flex flex-col gap-2 text-sm text-slate-400">
            {report.warnings.map((warning, index) => (
              <li key={`${warning}-${index}`} className="flex gap-2">
                <span className="text-amber-300">•</span>
                {warning}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            No warnings were returned for this dataset.
          </p>
        )}
      </section>
    </div>
  )
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] py-14 text-center">
      <Database className="mb-4 size-6 text-slate-600" />
      <h3 className="font-medium text-white">No datasets analyzed yet</h3>
      <p className="mt-1 max-w-xs text-sm text-slate-500">
        Upload your first CSV to see quality insights and column-level diagnostics.
      </p>
      <button
        type="button"
        onClick={onUpload}
        className="mt-4 text-sm font-medium text-indigo-300 hover:text-indigo-200"
      >
        Upload a dataset
      </button>
    </div>
  )
}

export default function CloudPulseDashboard() {
  const [view, setView] = useState<View>('overview')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [datasets, setDatasets] = useState<DatasetReport[]>([])
  const [selected, setSelected] = useState<DatasetReport | null>(null)

  const handleComplete = (result: DatasetReport) => {
    setDatasets((current) => [
      result,
      ...current.filter((item) => item.file_id !== result.file_id),
    ])
    setSelected(result)
    setView('analysis')
  }

  const completed = useMemo(
    () => datasets.filter((item) => item.status === 'COMPLETED'),
    [datasets],
  )

  const openDataset = (dataset: DatasetReport) => {
    setSelected(dataset)
    setView('analysis')
  }

  const scrollToUpload = () => {
    setView('overview')
    setMobileOpen(false)
    window.setTimeout(() => {
      document.getElementById('upload-card')?.scrollIntoView({
        behavior: 'smooth',
      })
    }, 0)
  }

  const content =
    view === 'analysis' && selected ? (
      <Analysis dataset={selected} onBack={() => setView('overview')} />
    ) : view === 'history' ? (
      <div>
        <div className="mb-7">
          <h1 className="text-2xl font-semibold text-white">Dataset history</h1>
          <p className="mt-2 text-sm text-slate-500">
            Every upload and analysis report in this workspace.
          </p>
        </div>
        {datasets.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
            <div className="divide-y divide-white/5">
              {datasets.map((dataset) => (
                <button
                  key={dataset.file_id}
                  type="button"
                  onClick={() => openDataset(dataset)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-white/[0.03]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="size-4 shrink-0 text-indigo-300" />
                    <span className="truncate text-sm font-medium text-white">
                      {dataset.original_filename}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="hidden text-xs text-slate-500 sm:block">
                      {dataset.file_id}
                    </span>
                    <StatusPill status={dataset.status} />
                    <ChevronRight className="size-4 text-slate-600" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState onUpload={scrollToUpload} />
        )}
      </div>
    ) : (
      <>
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm text-indigo-300">Good morning</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
              Data quality, at a glance.
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Upload a dataset to uncover what your data is really saying.
            </p>
          </div>
          <button
            type="button"
            onClick={scrollToUpload}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-400"
          >
            <Plus className="size-4" />
            New analysis
          </button>
        </div>

        <div id="upload-card">
          <UploadCard onComplete={handleComplete} />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Datasets analyzed"
            value={datasets.length.toString()}
            icon={Database}
          />
          <StatCard
            label="Completed reports"
            value={completed.length.toString()}
            icon={Check}
            accent="text-emerald-300"
          />
          <StatCard
            label="Latest status"
            value={datasets[0]?.status?.toLowerCase() || '—'}
            icon={FileBarChart}
            accent="text-violet-300"
          />
        </div>

        <div className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-medium text-white">Recent datasets</h2>
              <p className="mt-1 text-xs text-slate-500">
                Your latest uploads and reports
              </p>
            </div>
            {datasets.length > 0 && (
              <button
                type="button"
                onClick={() => setView('history')}
                className="text-xs text-indigo-300 hover:text-indigo-200"
              >
                View all <ChevronRight className="ml-0.5 inline size-3" />
              </button>
            )}
          </div>
          {datasets.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
              <div className="divide-y divide-white/5">
                {datasets.slice(0, 5).map((dataset) => (
                  <button
                    key={dataset.file_id}
                    type="button"
                    onClick={() => openDataset(dataset)}
                    className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-white/[0.04]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">
                        {dataset.original_filename}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {dataset.file_id}
                      </p>
                    </div>
                    <StatusPill status={dataset.status} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState onUpload={scrollToUpload} />
          )}
        </div>
      </>
    )

  return (
    <div className="min-h-screen bg-[#070914] text-slate-200 selection:bg-indigo-500/30">
      <aside
        className={`fixed inset-y-0 left-0 z-20 w-72 border-r border-white/10 bg-[#090d1b]/95 px-5 py-6 shadow-[18px_0_60px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-transform lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 px-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500 text-white shadow-lg shadow-indigo-500/20">
            <Cloud className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-wide text-white">
            Cloud<span className="text-indigo-300">Pulse</span>
          </span>
        </div>

        <div className="mt-10 flex flex-col gap-1">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setView(id)
                setMobileOpen(false)
              }}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                view === id
                  ? 'bg-gradient-to-r from-indigo-500/20 to-violet-500/10 text-indigo-100 shadow-inner shadow-indigo-400/10'
                  : 'text-slate-500 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="absolute inset-x-4 bottom-5 flex flex-col gap-1 border-t border-white/10 pt-4">
          <button
            type="button"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-200"
          >
            <Settings className="size-4" />
            Settings
          </button>
          <button
            type="button"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-200"
          >
            <CircleHelp className="size-4" />
            Help center
          </button>
          <div className="mt-3 flex items-center gap-3 border-t border-white/10 px-3 pt-4">
            <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-xs font-bold text-white">
              JD
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-white">CloudPulse</p>
              <p className="truncate text-[11px] text-slate-500">Free workspace</p>
            </div>
            <LogOut className="size-3.5 text-slate-600" />
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-10 bg-black/50 lg:hidden"
        />
      )}

      <main className="lg:pl-72">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-white/10 bg-[#080b14]/90 px-4 backdrop-blur-xl sm:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 lg:hidden"
            aria-label="Toggle navigation"
          >
            <Menu className="size-5" />
          </button>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">Workspace</span>
            <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-xs font-bold text-white">
              CP
            </div>
          </div>
        </header>
        <div className="relative mx-auto max-w-[1440px] px-5 py-10 sm:px-10">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/50 to-transparent" />
          {content}
        </div>
      </main>
    </div>
  )
}
