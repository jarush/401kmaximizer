const msInDay = 24 * 60 * 60 * 1000;

let chartInstance = null;

$(document).ready(() => {
  // Create the chart
  const ctx = $('#forecastChart')[0].getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Cumulative Pre-Tax ($)',
          stack: "combined",
          data: [],
          borderColor: '#2b6cb0',
          backgroundColor: 'rgba(43, 108, 176, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.1,
          pointStyle: 'circle',
          pointBorderWidth: 2,
          pointBackgroundColor: '#2b6cb0',
          pointBorderColor: '#2b6cb0'
        },
        {
          label: 'Cumulative Post-Tax ($)',
          stack: "combined",
          data: [],
          borderColor: '#319795',
          backgroundColor: 'rgba(49, 151, 149, 0.2)',
          borderWidth: 3,
          fill: true,
          tension: 0.1,
          pointStyle: 'circle',
          pointBorderWidth: 2,
          pointBackgroundColor: '#319795',
          pointBorderColor: '#319795'
        },
        {
          label: 'Company Match ($)',
          stack: "combined",
          data: [],
          borderColor: '#b7791f',
          backgroundColor: 'rgba(183, 121, 31, 0.15)',
          borderWidth: 3,
          fill: true,
          tension: 0.1,
          pointStyle: 'circle',
          pointBorderWidth: 2,
          pointBackgroundColor: '#b7791f',
          pointBorderColor: '#b7791f'
        },
        {
          label: 'Pre-Tax Limit',
          stack: 'limit-pretax',
          stacked: false,
          data: [],
          borderColor: '#e53e3e',
          borderWidth: 1.5,
          borderDash: [5, 5],
          fill: false,
          pointBorderColor: '#e53e3e',
          pointRadius: 0,
          pointHitRadius: 0
        },
        {
          label: 'Combined Limit',
          stack: 'limit-combined',
          stacked: false,
          data: [],
          borderColor: '#741b1b',
          borderWidth: 1.5,
          borderDash: [5, 5],
          fill: false,
          pointBorderColor: '#741b1b',
          pointRadius: 0,
          pointHitRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          stacked: true,
          beginAtZero: true,
          max: 30000,
          grid: { color: '#e2e8f0' }
        },
        x: { grid: { display: false } }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            pointStyle: 'line',
            boxWidth: 30
          }
        }
      }
    }
  });

  // Add handlers to the save/load buttons
  $('#save-input').on('click', exportJson);
  $('#load-input').on('change', importJson);

  // Re-compute whenever any input changes
  $('input, select').on('input change', calculateStrategy);
  calculateStrategy();
});

function calculateStrategy() {
  const limitPretax = parseFloat($('#limit-pretax').val()) || 0;
  const limitCombined = parseFloat($('#limit-combined').val()) || 0;
  const companyMatch = parseFloat($('#company-match').val()) || 0;
  const firstPayDateStr = $('#date-first-pay').val();
  const currentPayDateStr = $('#date-current-pay').val();
  const gross = parseFloat($('#paycheck-gross').val()) || 0;
  const ytdGross = parseFloat($('#paycheck-ytd-gross').val()) || 0;
  const ytdPretax = parseFloat($('#paycheck-ytd-pretax').val()) || 0;
  const ytdPosttax = parseFloat($('#paycheck-ytd-posttax').val()) || 0;
  const posttaxPct = parseFloat($('#paycheck-posttax-pct').val()) || 0;

  // Validate the input
  if (limitPretax <= 0 ||
      limitCombined <= 0 ||
      companyMatch <= 0 ||
      gross <= 0 ||
      ytdGross <= 0 ||
      ytdPretax < 0 ||
      ytdPosttax < 0 ||
      posttaxPct < 0 ||
      !firstPayDateStr ||
      !currentPayDateStr) {
    $('#schedule-text').html('<strong>Awaiting Inputs:</strong> Please provide valid income and date parameters.');
    $('#val-remaining-cap').text('$0.00');
    $('#val-paychecks-current').text('0');
    $('#val-paychecks-left').text('0');
    if (chartInstance) {
      chartInstance.data.labels = [];
      chartInstance.data.datasets.forEach(dataset => {
        dataset.data = [];
      });
      chartInstance.update();
    }
    return;
  }

  // Convert the date strings to date objects
  const firstPayDate = new Date(firstPayDateStr + 'T00:00:00');
  const currentPayDate = new Date(currentPayDateStr + 'T00:00:00');
  
  // Calculate various paycheck counts
  const paycheckCounts = getPaycheckCounts(firstPayDate, currentPayDate);
  const remainingPaychecks = paycheckCounts.remaining;
  const totalPaychecks = paycheckCounts.total;
  const currentPaycheckIndex = paycheckCounts.currentIndex;

  // Compute how much pre-tax contributions remain
  const remainingPretaxCap = limitPretax - ytdPretax;

  // Calculate the contribution schedule
  let initialPct = 0;
  let futurePct = 0;
  let switchPaycheckIndex = remainingPaychecks;
  if (remainingPaychecks > 0 && remainingPretaxCap > 0) {
    const contributionSchedule = getContributionSchedule(remainingPretaxCap, remainingPaychecks, gross);
    initialPct = contributionSchedule.initialPct;
    futurePct = contributionSchedule.futurePct;
    switchPaycheckIndex = contributionSchedule.switchPaycheckIndex;
  }

  // Estimate YTD match
  const approximatePastMatchRate = ytdGross > 0 ? Math.min(companyMatch, (ytdPretax / ytdGross) * 100) : 0;
  const ytdMatch = ytdGross * (approximatePastMatchRate / 100);

  // Calculate the chart data
  let runningPretax = 0;
  let runningPosttax = 0;
  let runningMatch = 0;
  const chartLabels = [];
  const chartDataPretax = [];
  const chartDataPosttax = [];
  const chartDataMatch = [];
  for (let i = 0; i < totalPaychecks; i++) {
    // Calculate the calendar date for this paycheck
    const payDate = new Date(firstPayDate.getTime() + (i * 14 * msInDay));
    chartLabels.push(payDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  
    if (i < currentPaycheckIndex) {
      // Estimate historical contributions from current YTD contributions
      runningPretax = ytdPretax * ((i + 1) / currentPaycheckIndex);
      runningPosttax = ytdPosttax * ((i + 1) / currentPaycheckIndex);
      runningMatch = ytdMatch * ((i + 1) / currentPaycheckIndex);
    } else {
      // Project future contributions
      const futureCheckNum = i - currentPaycheckIndex;
      const currentAppliedPct = (futureCheckNum < switchPaycheckIndex) ? initialPct : futurePct;
      const effectiveMatchPct = Math.min(companyMatch, currentAppliedPct);

      runningPretax += (gross * (currentAppliedPct / 100));
      runningPosttax += (gross * (posttaxPct / 100));
      runningMatch += (gross * (effectiveMatchPct / 100));
    }

    // Cap the data point to the IRS limit
    runningPretax = Math.min(limitPretax, runningPretax)
  
    // Add the data point to the chart data
    chartDataPretax.push(runningPretax);
    chartDataPosttax.push(runningPosttax);
    chartDataMatch.push(runningMatch);
  }

  // Create the schedule bullet list
  const $ul = $('<ul>');
  if (remainingPretaxCap <= 0 || remainingPaychecks <= 0) {
    // Already maxed
    $ul.append($('<li>').html('<strong>Fully Funded:</strong> No remaining paychecks or pre-tax cap reached.'));
  } else {
    // Start with what should be done today
    $ul.append($('<li>').html(`Set rate to <strong>${initialPct}%</strong> before the next paycheck.`));

    // Add when contributions need to be updated (if needed)
    if (switchPaycheckIndex !== remainingPaychecks && futurePct >= 0) {
      const targetCheckDate = new Date(firstPayDate.getTime() + ((currentPaycheckIndex + switchPaycheckIndex) * 14 * msInDay));
      const targetCheckDateStr = targetCheckDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const adjustDate = new Date(targetCheckDate.getTime() - (13 * msInDay));
      const adjustDateStr = adjustDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      $ul.append($('<li>').html(`On <strong>${adjustDateStr}</strong> change your rate to <strong>${futurePct}%</strong> so it processes in time for your <strong>${targetCheckDateStr}</strong> paycheck.`));
    }
  }

  // Check if any company match will be lost
  if (initialPct < companyMatch || futurePct < companyMatch) {
    $ul.append($('<li>').addClass('text-danger').text('Warning: Contribution rate falls below company match rate. You will lose some company match money.'));
  }

  // Verify aggregate totals under Section 415(c) caps
  const totalProjected = runningPretax + runningPosttax + runningMatch;
  if (totalProjected > limitCombined) {
    $ul.append($('<li>').addClass('text-danger').text(`Warning: Total projected contributions ($${totalProjected.toLocaleString(undefined, {maximumFractionDigits:0})}) exceed the IRS Combined Annual Limit.`));
  }

  $('#schedule-text').html($ul);

  // Display summary metrics on the analytics section
  $('#val-paychecks-current').text(currentPaycheckIndex);
  $('#val-paychecks-total').text(totalPaychecks);
  $('#val-paychecks-left').text(remainingPaychecks);
  $('#val-projected-pretax').text('$' + runningPretax.toLocaleString(undefined, {maximumFractionDigits: 2}));
  $('#val-projected-posttax').text('$' + runningPosttax.toLocaleString(undefined, {maximumFractionDigits: 2}));
  $('#val-projected-match').text('$' + runningMatch.toLocaleString(undefined, {maximumFractionDigits: 2}));
  $('#val-projected-total').text('$' + totalProjected.toLocaleString(undefined, {maximumFractionDigits: 2}));

  renderChart(chartLabels,
      chartDataPretax,
      chartDataPosttax,
      chartDataMatch,
      currentPaycheckIndex,
      currentPaycheckIndex + switchPaycheckIndex,
      limitPretax,
      limitCombined);
}

function getPaycheckCounts(firstPayDate, currentPayDate) {
  const currentYear = firstPayDate.getFullYear();
  const nextYearStart = new Date(currentYear + 1, 0, 1);

  // Calculate the current paycheck index (Math.round shields against DST shifts)
  const daysElapsed = Math.round((currentPayDate - firstPayDate) / msInDay);
  const currentIndex = (daysElapsed / 14) + 1;

  // Calculate the total number of paychecks in the year
  const totalDays = Math.round(((nextYearStart - 1) - firstPayDate) / msInDay);
  let total = Math.ceil(totalDays / 14);

  const finalPayDate = new Date(firstPayDate.getTime() + (total * 14 * msInDay));
  if (finalPayDate.getFullYear() === currentYear + 1 && finalPayDate.getMonth() === 0 && finalPayDate.getDate() === 1) {
    // Extra paycheck this year; the final pay date is New Year's holiday
    total++;
  }

  // Calculate the number of remaining paychecks
  const remaining = total - currentIndex;

  return { total, remaining, currentIndex };
}

function getContributionSchedule(remainingPretaxCap, remainingPaychecks, currentGross) {
  const rawTargetPct = (remainingPretaxCap / (remainingPaychecks * currentGross)) * 100;
  const initialPct = Math.ceil(rawTargetPct);
  const futurePct = Math.floor(rawTargetPct);

  // Default to all checks at the same rate if it divides into a perfect integer
  if (initialPct === futurePct) {
    return { initialPct, futurePct, switchPaycheckIndex: remainingPaychecks };
  }

  // Compute
  const totalAtLowerRate = remainingPaychecks * currentGross * (futurePct / 100);
  const deficitToCover = remainingPretaxCap - totalAtLowerRate;
  const perPaycheckDifference = currentGross * ((initialPct - futurePct) / 100);

  // Math.ceil ensures we safely cover the exact threshold cap
  const switchPaycheckIndex = Math.ceil(deficitToCover / perPaycheckDifference);

  return { initialPct, futurePct, switchPaycheckIndex };
}

function renderChart(labels, pretaxData, posttaxData, matchData, historyLimit,
    switchIdx, preTaxLimit, combinedLimit) {
  if (!chartInstance) {
    return;
  }

  // Directly assign the labels array
  chartInstance.data.labels = labels;

  // Update the pre-tax contributions
  const pointColors = pretaxData.map((v, i) => i === switchIdx ? '#dd6b20' : (i < historyLimit ? '#718096' : '#2b6cb0'));
  chartInstance.data.datasets[0].data = pretaxData;
  chartInstance.data.datasets[0].pointBackgroundColor = pointColors;
  chartInstance.data.datasets[0].pointBorderColor = pointColors;

  // Update post-tax contributions
  chartInstance.data.datasets[1].data = posttaxData;

  // Update company match
  chartInstance.data.datasets[2].data = matchData;

  // Update the IRS limits
  chartInstance.data.datasets[3].data = Array(labels.length).fill(preTaxLimit);
  chartInstance.data.datasets[4].data = Array(labels.length).fill(combinedLimit);

  // Only show post-tax info if there is any data
  const hasPostTax = posttaxData.length > 0 && posttaxData.at(-1) > 0;
  chartInstance.data.datasets[1].hidden = !hasPostTax;
  chartInstance.data.datasets[4].hidden = !hasPostTax;

  // Clear the max scale to auto-calculate
  chartInstance.options.scales.y.max = undefined;

  // Run the native transition animation loop
  chartInstance.update();
}

function exportJson() {
  const dataset = {
    limitPretax: $('#limit-pretax').val(),
    limitCombined: $('#limit-combined').val(),
    companyMatch: $('#company-match').val(),
    dateFirstPay: $('#date-first-pay').val(),
    dateCurrentPay: $('#date-current-pay').val(),
    paycheckGross: $('#paycheck-gross').val(),
    paycheckYtdGross: $('#paycheck-ytd-gross').val(),
    paycheckYtdPretax: $('#paycheck-ytd-pretax').val(),
    paycheckYtdPosttax: $('#paycheck-ytd-posttax').val(),
    paycheckPosttaxPct: $('#paycheck-posttax-pct').val()
  };

  const jsonString = JSON.stringify(dataset, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = '401k-maximizer-profile.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function importJson(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const dataset = JSON.parse(evt.target.result);

      if (dataset.limitPretax) $('#limit-pretax').val(dataset.limitPretax);
      if (dataset.limitCombined) $('#limit-combined').val(dataset.limitCombined);
      if (dataset.companyMatch) $('#company-match').val(dataset.companyMatch);
      if (dataset.dateFirstPay) $('#date-first-pay').val(dataset.dateFirstPay);
      if (dataset.dateCurrentPay) $('#date-current-pay').val(dataset.dateCurrentPay);
      if (dataset.paycheckGross) $('#paycheck-gross').val(dataset.paycheckGross);
      if (dataset.paycheckYtdGross) $('#paycheck-ytd-gross').val(dataset.paycheckYtdGross);
      if (dataset.paycheckYtdPretax) $('#paycheck-ytd-pretax').val(dataset.paycheckYtdPretax);
      if (dataset.paycheckYtdPosttax) $('#paycheck-ytd-posttax').val(dataset.paycheckYtdPosttax);
      if (dataset.paycheckPosttaxPct) $('#paycheck-posttax-pct').val(dataset.paycheckPosttaxPct);

      calculateStrategy();
      $('#upload-json').val('');
    } catch (err) {
      alert('Error parsing file: Invalid file structure or format.' + err);
    }
  };
  reader.readAsText(file);
}
