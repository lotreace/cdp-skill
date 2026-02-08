import { Chart, registerables } from 'chart.js';
import './style.css';

Chart.register(...registerables);

const COLORS = {
  blue: '#388bfd', green: '#3fb950', purple: '#a371f7',
  orange: '#d29922', red: '#f85149', cyan: '#56d4dd',
  blueAlpha: '#388bfd44', greenAlpha: '#3fb95044',
  purpleAlpha: '#a371f744', orangeAlpha: '#d2992244'
};

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: { legend: { labels: { color: '#8b949e', font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
    y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } }
  }
};

function shortId(id) {
  return id.replace(/^\d+-/, '').replace(/-/g, ' ');
}

function renderNoData(app) {
  app.innerHTML = `
    <h1>CDP-Bench Flywheel Dashboard</h1>
    <div class="no-data">
      <h2>No dataset found</h2>
      <p style="color:#8b949e">Generate the dataset from cdp-bench data:</p>
      <code>npm run dataset</code>
    </div>
  `;
}

function renderSubtitle(trend) {
  const first = trend[0];
  const last = trend[trend.length - 1];
  const versions = [...new Set(trend.map(t => t.version))];
  const versionStr = versions.length > 1
    ? `v${versions[0]} &rarr; v${versions[versions.length - 1]}`
    : `v${versions[0]}`;
  const lastTs = last.ts ? last.ts.slice(0, 16) : '';
  return `${versionStr} &middot; ${trend.length} cranks &middot; ${last.tests} tests &middot; Last run: ${lastTs}`;
}

function renderKPIs(container, trend, traces) {
  const latest = trend[trend.length - 1];
  const prev = trend.length > 1 ? trend[trend.length - 2] : latest;
  const latestCrank = trend.length;
  const crankTraces = traces.filter(t => t.crank === latestCrank);

  const avgSteps = crankTraces.length
    ? (crankTraces.reduce((s, t) => s + t.steps, 0) / crankTraces.length).toFixed(1)
    : '—';
  const timeable = crankTraces.filter(t => t.wallClockMs);
  const avgTime = timeable.length
    ? (timeable.reduce((s, t) => s + t.wallClockMs, 0) / timeable.length / 1000).toFixed(1) + 's'
    : '—';
  const totalErrors = crankTraces.reduce((s, t) => s + t.errors, 0);

  const kpis = [
    { label: 'SHS', value: latest.shs, delta: latest.shs - prev.shs, color: COLORS.blue },
    { label: 'Tests', value: latest.tests, delta: latest.tests - prev.tests, color: COLORS.green },
    { label: 'Perfect Rate', value: (latest.perfectRate * 100).toFixed(0) + '%', delta: ((latest.perfectRate - prev.perfectRate) * 100).toFixed(0) + '%', color: COLORS.purple },
    { label: 'Avg Steps', value: avgSteps, delta: null, color: COLORS.orange },
    { label: 'Avg Time', value: avgTime, delta: null, color: COLORS.cyan },
    { label: 'Total Errors', value: totalErrors, delta: null, color: COLORS.red }
  ];

  container.innerHTML = kpis.map(k => {
    const deltaClass = k.delta > 0 ? 'up' : k.delta < 0 ? 'down' : 'flat';
    const deltaStr = k.delta !== null
      ? `<div class="delta ${deltaClass}">${k.delta > 0 ? '+' : ''}${k.delta}</div>`
      : '';
    return `<div class="kpi"><div class="value" style="color:${k.color}">${k.value}</div>${deltaStr}<div class="label">${k.label}</div></div>`;
  }).join('');
}

function renderSHSChart(canvas, trend, crankLabels) {
  new Chart(canvas, {
    type: 'line',
    data: {
      labels: crankLabels,
      datasets: [{
        label: 'SHS',
        data: trend.map(t => t.shs),
        borderColor: COLORS.blue,
        backgroundColor: COLORS.blueAlpha,
        fill: true,
        tension: 0.3,
        pointRadius: 6,
        pointBackgroundColor: COLORS.blue
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, min: 90, max: 102, ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 2 } }
      }
    }
  });
}

function renderMetricsChart(canvas, trend, cranks, crankLabels) {
  const metricKeys = [
    { key: 'passRate', label: 'Pass Rate' },
    { key: 'perfectRate', label: 'Perfect Rate' },
    { key: 'avgCompletion', label: 'Avg Completion' },
    { key: 'avgEfficiency', label: 'Avg Efficiency' },
    { key: 'categoryCoverage', label: 'Category Coverage' }
  ];
  const palette = [COLORS.orangeAlpha, COLORS.blueAlpha, COLORS.greenAlpha];
  const borders = [COLORS.orange, COLORS.blue, COLORS.green];

  new Chart(canvas, {
    type: 'radar',
    data: {
      labels: metricKeys.map(m => m.label),
      datasets: cranks.map((c, i) => ({
        label: crankLabels[i],
        data: metricKeys.map(m => trend[i][m.key]),
        borderColor: borders[i % borders.length],
        backgroundColor: palette[i % palette.length],
        pointRadius: 4
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        r: {
          min: 0.9, max: 1.01,
          ticks: { color: '#8b949e', backdropColor: 'transparent', stepSize: 0.02 },
          grid: { color: '#21262d' },
          pointLabels: { color: '#8b949e', font: { size: 11 } },
          angleLines: { color: '#21262d' }
        }
      },
      plugins: { legend: { labels: { color: '#8b949e', font: { size: 11 } } } }
    }
  });
}

function renderStepsChart(canvas, traces, cranks, crankLabels, allTestIds) {
  const crankColors = [COLORS.orange, COLORS.blue, COLORS.green];

  const datasets = cranks.map((c, i) => ({
    label: `Crank ${c} Steps`,
    data: allTestIds.map(id => {
      const t = traces.find(x => x.crank === c && x.testId === id);
      return t ? t.steps : null;
    }),
    backgroundColor: crankColors[i % crankColors.length],
    borderRadius: 3
  }));

  datasets.push({
    label: 'Budget',
    data: allTestIds.map(id => {
      const t = traces.find(x => x.testId === id);
      return t ? t.budget : null;
    }),
    type: 'line',
    borderColor: '#f8514988',
    borderDash: [6, 3],
    pointRadius: 3,
    pointBackgroundColor: '#f85149',
    fill: false,
    tension: 0
  });

  new Chart(canvas, {
    type: 'bar',
    data: { labels: allTestIds.map(shortId), datasets },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        x: { ...CHART_DEFAULTS.scales.x, ticks: { ...CHART_DEFAULTS.scales.x.ticks, maxRotation: 45 } },
        y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, title: { display: true, text: 'Steps', color: '#8b949e' } }
      }
    }
  });
}

function renderWallClockChart(canvas, traces, cranks, allTestIds) {
  const crankColors = [COLORS.orange, COLORS.blue, COLORS.green];

  const datasets = cranks.map((c, i) => ({
    label: `Crank ${c}`,
    data: allTestIds.map(id => {
      const t = traces.find(x => x.crank === c && x.testId === id);
      return t && t.wallClockMs ? Math.round(t.wallClockMs / 1000) : null;
    }),
    backgroundColor: crankColors[i % crankColors.length],
    borderRadius: 3
  }));

  new Chart(canvas, {
    type: 'bar',
    data: { labels: allTestIds.map(shortId), datasets },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        x: { ...CHART_DEFAULTS.scales.x, ticks: { ...CHART_DEFAULTS.scales.x.ticks, maxRotation: 45 } },
        y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, title: { display: true, text: 'Seconds', color: '#8b949e' } }
      }
    }
  });
}

function renderEfficiencyChart(canvas, traces, cranks) {
  const crankColors = [COLORS.orange, COLORS.blue, COLORS.green];
  const buckets = ['< 25%', '25-50%', '50-75%', '75-100%'];

  const effData = cranks.map(c => {
    const ct = traces.filter(t => t.crank === c);
    const ratios = ct.map(t => t.steps / t.budget);
    return [
      ratios.filter(r => r < 0.25).length,
      ratios.filter(r => r >= 0.25 && r < 0.5).length,
      ratios.filter(r => r >= 0.5 && r < 0.75).length,
      ratios.filter(r => r >= 0.75).length
    ];
  });

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: buckets,
      datasets: cranks.map((c, i) => ({
        label: `Crank ${c}`,
        data: effData[i],
        backgroundColor: crankColors[i % crankColors.length],
        borderRadius: 3
      }))
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        x: { ...CHART_DEFAULTS.scales.x, title: { display: true, text: 'Steps / Budget Ratio', color: '#8b949e' } },
        y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, title: { display: true, text: 'Test Count', color: '#8b949e' }, ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 1 } }
      }
    }
  });
}

function renderErrorsChart(canvas, traces, cranks, crankLabels) {
  const errorsByCrank = cranks.map(c => traces.filter(t => t.crank === c).reduce((s, t) => s + t.errors, 0));
  const testsWithErrors = cranks.map(c => traces.filter(t => t.crank === c && t.errors > 0).length);

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: crankLabels,
      datasets: [
        { label: 'Total Errors', data: errorsByCrank, backgroundColor: COLORS.red, borderRadius: 3 },
        { label: 'Tests with Errors', data: testsWithErrors, backgroundColor: COLORS.orange, borderRadius: 3 }
      ]
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, beginAtZero: true, ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 1 } }
      }
    }
  });
}

function renderErrorLog(container, errorDetails) {
  if (!errorDetails.length) {
    container.innerHTML = '<p style="color:#8b949e;font-size:13px;margin-top:12px">No errors recorded.</p>';
    return;
  }
  container.innerHTML = errorDetails.map(e => `
    <div class="error-entry">
      <span class="error-crank">Crank ${e.crank}</span>
      <span class="error-test">${e.testId}</span>
      <span class="error-detail">${e.error}</span>
    </div>
  `).join('');
}

function renderFixLog(container, fixes) {
  if (!fixes.length) {
    container.innerHTML = '<p style="color:#8b949e;font-size:13px;margin-top:12px">No fixes recorded.</p>';
    return;
  }
  container.innerHTML = fixes.map(f => `
    <div class="fix-entry">
      <span class="fix-crank">Crank ${f.crank}</span>
      <span class="fix-outcome ${f.outcome}">${f.outcome}</span>
      <span class="fix-title">#${f.issueId}: ${f.title}</span>
      <span class="fix-delta ${f.shsDelta > 0 ? 'delta up' : f.shsDelta < 0 ? 'delta down' : 'delta flat'}">SHS ${f.shsDelta > 0 ? '+' : ''}${f.shsDelta}</span>
    </div>
  `).join('');
}

function renderFeedbackChart(canvas, feedback, cranks, crankLabels) {
  const types = ['improvement', 'bug', 'workaround', 'observation'];
  const typeColors = {
    improvement: COLORS.blue,
    bug: COLORS.red,
    workaround: COLORS.orange,
    observation: COLORS.cyan
  };

  const datasets = types.map(type => ({
    label: type.charAt(0).toUpperCase() + type.slice(1),
    data: cranks.map(c => feedback.filter(fb => fb.crank === c && fb.type === type).length),
    backgroundColor: typeColors[type],
    borderRadius: 3
  })).filter(ds => ds.data.some(v => v > 0));

  new Chart(canvas, {
    type: 'bar',
    data: { labels: crankLabels, datasets },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        x: { ...CHART_DEFAULTS.scales.x, stacked: true },
        y: { ...CHART_DEFAULTS.scales.y, stacked: true, beginAtZero: true, ticks: { ...CHART_DEFAULTS.scales.y.ticks, stepSize: 1 } }
      },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: { mode: 'index', intersect: false }
      }
    }
  });
}

function renderFeedbackByArea(canvas, feedback) {
  const areaCounts = {};
  for (const fb of feedback) {
    areaCounts[fb.area] = (areaCounts[fb.area] || 0) + fb.count;
  }
  const areas = Object.keys(areaCounts).sort((a, b) => areaCounts[b] - areaCounts[a]);
  const areaColors = {
    actions: COLORS.blue, snapshot: COLORS.green, navigation: COLORS.purple,
    iframe: COLORS.orange, input: COLORS.cyan, 'error-handling': COLORS.red,
    'shadow-dom': '#a371f7', timing: '#d29922', other: '#8b949e'
  };

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: areas,
      datasets: [{
        label: 'Feedback Count',
        data: areas.map(a => areaCounts[a]),
        backgroundColor: areas.map(a => areaColors[a] || '#8b949e'),
        borderRadius: 3
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: 'y',
      scales: {
        x: { ...CHART_DEFAULTS.scales.x, beginAtZero: true, ticks: { ...CHART_DEFAULTS.scales.x.ticks, stepSize: 1 } },
        y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, font: { size: 12 } } }
      }
    }
  });
}

function renderFeedbackLog(container, feedback) {
  if (!feedback.length) {
    container.innerHTML = '<p style="color:#8b949e;font-size:13px;margin-top:12px">No feedback collected from runners yet.</p>';
    return;
  }

  const typeEmoji = { improvement: 'lightbulb', bug: 'bug', workaround: 'wrench', observation: 'eye' };

  container.innerHTML = feedback.map(fb => {
    const typeClass = fb.type || 'improvement';
    const testsStr = (fb.tests || []).map(shortId).join(', ');
    const countBadge = fb.count > 1 ? `<span class="fb-count">${fb.count}x</span>` : '';
    return `
      <div class="fb-entry">
        <span class="fb-crank">Crank ${fb.crank}</span>
        <span class="fb-type ${typeClass}">${typeClass}</span>
        <span class="fb-area">${fb.area}</span>
        ${countBadge}
        <span class="fb-title">${fb.title}</span>
        <span class="fb-tests">${testsStr}</span>
      </div>
    `;
  }).join('');
}

function renderDashboard(data) {
  const { trend, fixes, traces, errorDetails } = data;
  const feedback = data.feedback || [];
  const app = document.getElementById('app');

  const cranks = trend.map((_, i) => i + 1);
  const crankLabels = cranks.map(c => {
    const t = trend[c - 1];
    return `Crank ${c} (${t.version})`;
  });
  const allTestIds = [...new Set(traces.map(t => t.testId))].sort();

  app.innerHTML = `
    <h1>CDP-Bench Flywheel Dashboard</h1>
    <p class="subtitle">${renderSubtitle(trend)}</p>
    <div class="kpi-row" id="kpi-row"></div>
    <div class="grid">
      <div class="card">
        <h2>Skill Health Score (SHS)</h2>
        <p class="card-desc">Composite health metric (0-100) weighting pass rate (40%), average completion (25%), perfect rate (15%), efficiency (10%), and category coverage (10%).</p>
        <canvas id="shs-chart"></canvas>
      </div>
      <div class="card">
        <h2>Aggregate Metrics</h2>
        <p class="card-desc">Five dimensions that compose SHS. Pass Rate = tests scoring above 50%. Perfect Rate = tests hitting every milestone. Avg Completion = mean milestone weight achieved. Avg Efficiency = budget utilization. Category Coverage = fraction of categories with a passing test.</p>
        <canvas id="metrics-chart"></canvas>
      </div>
      <div class="card grid-full">
        <h2>Steps Used vs Budget (by test)</h2>
        <canvas id="steps-chart" style="max-height:400px"></canvas>
      </div>
      <div class="card grid-full">
        <h2>Wall Clock Time (seconds, by test)</h2>
        <canvas id="wallclock-chart" style="max-height:400px"></canvas>
      </div>
      <div class="card">
        <h2>Efficiency Distribution (steps/budget)</h2>
        <p class="card-desc">How much of the step budget each test consumes. Lower is better — tests in the &lt;25% bucket complete the task using less than a quarter of their allowed steps.</p>
        <canvas id="efficiency-chart"></canvas>
      </div>
      <div class="card">
        <h2>Error Count by Crank</h2>
        <canvas id="errors-chart"></canvas>
        <div class="error-log" id="error-log"></div>
      </div>
      <div class="card grid-full">
        <h2>Fix History</h2>
        <div class="fix-log" id="fix-log"></div>
      </div>
      <div class="card">
        <h2>Runner Feedback by Crank</h2>
        <p class="card-desc">Structured feedback from runner agents — improvements, bugs, workarounds, and observations collected during test execution. This data flows back into improvements.json to close the flywheel loop.</p>
        <canvas id="feedback-chart"></canvas>
      </div>
      <div class="card">
        <h2>Feedback by Area</h2>
        <p class="card-desc">Which areas of cdp-skill receive the most feedback. High counts indicate areas needing attention.</p>
        <canvas id="feedback-area-chart"></canvas>
      </div>
      <div class="card grid-full">
        <h2>Feedback Log</h2>
        <div class="fb-log" id="feedback-log"></div>
      </div>
    </div>
  `;

  renderKPIs(document.getElementById('kpi-row'), trend, traces);
  renderSHSChart(document.getElementById('shs-chart'), trend, crankLabels);
  renderMetricsChart(document.getElementById('metrics-chart'), trend, cranks, crankLabels);
  renderStepsChart(document.getElementById('steps-chart'), traces, cranks, crankLabels, allTestIds);
  renderWallClockChart(document.getElementById('wallclock-chart'), traces, cranks, allTestIds);
  renderEfficiencyChart(document.getElementById('efficiency-chart'), traces, cranks);
  renderErrorsChart(document.getElementById('errors-chart'), traces, cranks, crankLabels);
  renderErrorLog(document.getElementById('error-log'), errorDetails);
  renderFixLog(document.getElementById('fix-log'), fixes);
  renderFeedbackChart(document.getElementById('feedback-chart'), feedback, cranks, crankLabels);
  renderFeedbackByArea(document.getElementById('feedback-area-chart'), feedback);
  renderFeedbackLog(document.getElementById('feedback-log'), feedback);
}

async function main() {
  const app = document.getElementById('app');
  try {
    const resp = await fetch('/data/dataset.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderDashboard(data);
  } catch {
    renderNoData(app);
  }
}

main();
