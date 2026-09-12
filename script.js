// IRS limits to sanity check the user's inputs
const IrsLimitsByYear = {
  2024: {
    preTax: 23000,
    combined: 69000,
    catchUp: 7500,
    enhancedCatchUp: 7500
  },
  2025: {
    preTax: 23500,
    combined: 70000,
    catchUp: 7500,
    enhancedCatchUp: 11250
  },
  2026: {
    preTax: 24500,
    combined: 72000,
    catchUp: 8000,
    enhancedCatchUp: 11250
  }
};

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
          pointBackgroundColor: (context) => {
            const idx = context.dataIndex;
            const options = context.chart.options;
            if (idx === options.switchIdx) {
              return '#dd6b20'; // Orange
            } else if (idx < options.historyLimit) {
              return '#718096'; // Grey
            } else {
              return '#2b6cb0'; // Blue
            }
          },
          pointBorderColor: (context) => context.dataset.pointBackgroundColor(context)
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
          stack: 'limitPreTax',
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
          stack: 'limitCombined',
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

      // Custom options used by the point color func
      historyLimit: 0,
      switchIdx: 0,

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
  const ageBracket = $('#ageBracket').val();
  const limitPreTax = parseFloat($('#limitPreTax').val()) || 0;
  const limitCombined = parseFloat($('#limitCombined').val()) || 0;
  const companyMatchPct = parseFloat($('#companyMatchPct').val()) || 0;
  const firstPaycheckDateStr = $('#firstPaycheckDate').val();
  const paycheckDateStr = $('#paycheckDate').val();
  const paycheckGross = parseFloat($('#paycheckGross').val()) || 0;
  const paycheckYtdGross = parseFloat($('#paycheckYtdGross').val()) || 0;
  const paycheckYtdPreTaxContrib = parseFloat($('#paycheckYtdPreTaxContrib').val()) || 0;
  const paycheckYtdPostTaxContrib = parseFloat($('#paycheckYtdPostTaxContrib').val()) || 0;
  const futurePostTaxContribPct = parseFloat($('#futurePostTaxContribPct').val()) || 0;

  // Validate the input
  if (!ageBracket ||
      limitPreTax <= 0 ||
      limitCombined <= 0 ||
      companyMatchPct <= 0 ||
      !firstPaycheckDateStr ||
      !paycheckDateStr ||
      paycheckGross <= 0 ||
      paycheckYtdGross <= 0 ||
      paycheckYtdPreTaxContrib < 0 ||
      paycheckYtdPostTaxContrib < 0 ||
      futurePostTaxContribPct < 0) {
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
  const [y1, m1, d1] = firstPaycheckDateStr.split('-').map(Number);
  const firstPaycheckDate = new Date(y1, m1 - 1, d1);
  const [y2, m2, d2] = paycheckDateStr.split('-').map(Number);
  const paycheckDate = new Date(y2, m2 - 1, d2);

  // Calculate various paycheck counts
  const paycheckCounts = getPaycheckCounts(firstPaycheckDate, paycheckDate);
  const remainingPaychecks = paycheckCounts.remaining;
  const totalPaychecks = paycheckCounts.total;
  const currentPaycheckIndex = paycheckCounts.currentIndex;

  // Compute how much pre-tax contributions remain
  const remainingPreTaxCap = limitPreTax - paycheckYtdPreTaxContrib;

  // Calculate the contribution schedule
  let initialPct = 0;
  let futurePct = 0;
  let switchPaycheckIndex = remainingPaychecks;
  if (remainingPaychecks > 0 && remainingPreTaxCap > 0) {
    const contributionSchedule = getContributionSchedule(remainingPreTaxCap, remainingPaychecks, paycheckGross);
    initialPct = contributionSchedule.initialPct;
    futurePct = contributionSchedule.futurePct;
    switchPaycheckIndex = contributionSchedule.switchPaycheckIndex;
  }

  // Estimate YTD match
  const approximatePastMatchRate = paycheckYtdGross > 0 ? Math.min(companyMatchPct, (paycheckYtdPreTaxContrib / paycheckYtdGross) * 100) : 0;
  const ytdMatch = paycheckYtdGross * (approximatePastMatchRate / 100);

  // Calculate the chart data
  let runningPreTax = 0;
  let runningPostTax = 0;
  let runningMatch = 0;
  const chartLabels = [];
  const chartDataPreTax = [];
  const chartDataPostTax = [];
  const chartDataMatch = [];
  for (let i = 0; i < totalPaychecks; i++) {
    // Calculate the calendar date for this paycheck
    const payDate = new Date(firstPaycheckDate);
    payDate.setDate(firstPaycheckDate.getDate() + (i * 14));
    chartLabels.push(payDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

    if (i < currentPaycheckIndex) {
      // Estimate historical contributions from current YTD contributions
      runningPreTax = paycheckYtdPreTaxContrib * ((i + 1) / currentPaycheckIndex);
      runningPostTax = paycheckYtdPostTaxContrib * ((i + 1) / currentPaycheckIndex);
      runningMatch = ytdMatch * ((i + 1) / currentPaycheckIndex);
    } else {
      // Project future contributions
      const futureCheckNum = i - currentPaycheckIndex;
      const currentAppliedPct = (futureCheckNum < switchPaycheckIndex) ? initialPct : futurePct;
      const effectiveMatchPct = Math.min(companyMatchPct, currentAppliedPct);

      runningPreTax += (paycheckGross * (currentAppliedPct / 100));
      runningPostTax += (paycheckGross * (futurePostTaxContribPct / 100));
      runningMatch += (paycheckGross * (effectiveMatchPct / 100));
    }

    // Cap the data point to the IRS limit
    runningPreTax = Math.min(limitPreTax, runningPreTax)

    // Add the data point to the chart data
    chartDataPreTax.push(runningPreTax);
    chartDataPostTax.push(runningPostTax);
    chartDataMatch.push(runningMatch);
  }

  // Create the schedule bullet list
  const $ul = $('<ul>');
  if (remainingPreTaxCap <= 0 || remainingPaychecks <= 0) {
    // Already maxed
    $ul.append($('<li>').html('<strong>Fully Funded:</strong> No remaining paychecks or pre-tax cap reached.'));
  } else {
    // Start with what should be done today
    $ul.append($('<li>').html(`Set rate to <strong>${initialPct}%</strong> before the next paycheck.`));

    // Add when contributions need to be updated (if needed)
    if (switchPaycheckIndex !== remainingPaychecks && futurePct >= 0) {
      // Project the target paycheck date forward 1 week
      const targetCheckDate = new Date(firstPaycheckDate);
      targetCheckDate.setDate(firstPaycheckDate.getDate() + ((currentPaycheckIndex + switchPaycheckIndex) * 14));
      const targetCheckDateStr = targetCheckDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      // Step back 13 days to find the adjustment reminder date
      const adjustDate = new Date(targetCheckDate);
      adjustDate.setDate(targetCheckDate.getDate() - 13);
      const adjustDateStr = adjustDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      $ul.append($('<li>').html(`On <strong>${adjustDateStr}</strong> change your rate to <strong>${futurePct}%</strong> so it processes in time for your <strong>${targetCheckDateStr}</strong> paycheck.`));
    }
  }

  // Check if any company match will be lost
  if (initialPct < companyMatchPct || futurePct < companyMatchPct) {
    $ul.append($('<li>')
      .addClass('text-danger')
      .text('Warning: Contribution rate falls below company match rate. You will lose some company match money.'));
  }

  // Verify aggregate totals under Section 415(c) caps
  const totalProjected = runningPreTax + runningPostTax + runningMatch;
  if (totalProjected > limitCombined) {
    $ul.append($('<li>')
      .addClass('text-danger')
      .text(`Warning: Total projected contributions ($${totalProjected.toLocaleString(undefined, {maximumFractionDigits:0})}) exceed the IRS Combined Annual Limit.`));
  }

  // Add a warning if the limits seem fishy
  const selectedYear = firstPaycheckDate.getFullYear();
  const actualYearLimits = IrsLimitsByYear[selectedYear];
  if (actualYearLimits) {
    // Check if the user's inputs deviate from that year's official IRS defaults
    let expectedPreTax = actualYearLimits.preTax;
    let expectedCombined = actualYearLimits.combined;

    // Adjust expected defaults dynamically based on the age bracket choice
    if (ageBracket === '50-59' || ageBracket === '64-plus') {
      expectedPreTax += actualYearLimits.catchUp;
      expectedCombined += actualYearLimits.catchUp;
    } else if (ageBracket === '60-63') {
      expectedPreTax += actualYearLimits.enhancedCatchUp;
      expectedCombined += actualYearLimits.enhancedCatchUp;
    }

    if (limitPreTax !== expectedPreTax || limitCombined !== expectedCombined) {
      $ul.append($('<li>')
        .addClass('text-danger')
        .text(`Warning: Limits differ from official ${selectedYear} IRS defaults for your age bracket (Pre-Tax: $${expectedPreTax.toLocaleString()}, Combined: $${expectedCombined.toLocaleString()}).`));
    }
  } else {
    const $link = $('<a>', {
      href: 'https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions',
      target: '_blank',
      rel: 'noopener noreferrer',
      class: 'alert-link',
      text: 'Review official IRS limits'
    }).css('text-decoration', 'underline');

    // Provide a warning that we cannot verify the limits
    $ul.append($('<li>')
      .addClass('text-danger')
      .text(`Warning: Cannot verify limits. ${selectedYear} data has not been added to the dataset yet. `)
      .append($link)
      .append('.')
    );
  }

  $('#schedule-text').html($ul);

  const newPreTaxContrib = paycheckGross * (initialPct / 100);
  const newPostTaxContrib = paycheckGross * (futurePostTaxContribPct / 100);

  // Display summary metrics on the analytics section
  $('#val-paychecks-current').text(currentPaycheckIndex);
  $('#val-paychecks-total').text(totalPaychecks);
  $('#val-new-pretax-contrib').text('$' + newPreTaxContrib.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  $('#val-new-posttax-contrib').text('$' + newPostTaxContrib.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  $('#val-projected-pretax').text('$' + runningPreTax.toLocaleString(undefined, {maximumFractionDigits: 2}));
  $('#val-projected-posttax').text('$' + runningPostTax.toLocaleString(undefined, {maximumFractionDigits: 2}));
  $('#val-projected-match').text('$' + runningMatch.toLocaleString(undefined, {maximumFractionDigits: 2}));
  $('#val-projected-total').text('$' + totalProjected.toLocaleString(undefined, {maximumFractionDigits: 2}));

  renderChart(chartLabels,
      chartDataPreTax,
      chartDataPostTax,
      chartDataMatch,
      currentPaycheckIndex,
      currentPaycheckIndex + switchPaycheckIndex,
      limitPreTax,
      limitCombined);
}

function getPaycheckCounts(firstPaycheckDate, paycheckDate) {
  const msPerDay = 24 * 60 * 60 * 1000;

  const currentYear = firstPaycheckDate.getFullYear();
  const nextYearStart = new Date(currentYear + 1, 0, 1);

  // Calculate the current paycheck index (Math.round shields against DST shifts)
  const currentIndex = (Math.round((paycheckDate - firstPaycheckDate) / msPerDay) / 14) + 1;

  // Calculate the total number of paychecks in the year
  let total = Math.ceil(((nextYearStart - firstPaycheckDate) / msPerDay) / 14);

  // Compute the last pay date
  const finalPayDate = new Date(firstPaycheckDate);
  finalPayDate.setDate(firstPaycheckDate.getDate() + (total * 14));
  if (finalPayDate.getFullYear() === currentYear + 1 &&
      finalPayDate.getMonth() === 0 &&
      finalPayDate.getDate() === 1) {
    // Final pay date falls on new years holiday, there is an extra paycheck this year
    total++;
  }

  // Calculate the number of remaining paychecks
  const remaining = total - currentIndex;

  return { total, remaining, currentIndex };
}

function getContributionSchedule(remainingPreTaxCap, remainingPaychecks, paycheckGross) {
  const rawTargetPct = (remainingPreTaxCap / (remainingPaychecks * paycheckGross)) * 100;
  const initialPct = Math.ceil(rawTargetPct);
  const futurePct = Math.floor(rawTargetPct);

  // Default to all checks at the same rate if it divides into a perfect integer
  if (initialPct === futurePct) {
    return { initialPct, futurePct, switchPaycheckIndex: remainingPaychecks };
  }

  // Compute
  const totalAtLowerRate = remainingPaychecks * paycheckGross * (futurePct / 100);
  const deficitToCover = remainingPreTaxCap - totalAtLowerRate;
  const perPaycheckDifference = paycheckGross * ((initialPct - futurePct) / 100);

  // Math.ceil ensures we safely cover the exact threshold cap
  const switchPaycheckIndex = Math.ceil(deficitToCover / perPaycheckDifference);

  return { initialPct, futurePct, switchPaycheckIndex };
}

function renderChart(labels, pretaxData, posttaxData, matchData, historyLimit, switchIdx, preTaxLimit, combinedLimit) {
  if (!chartInstance) {
    return;
  }

  // Update our state in the chart for the point color funcs
  chartInstance.options.historyLimit = historyLimit;
  chartInstance.options.switchIdx = switchIdx;

  // Update the datasets
  chartInstance.data.labels = labels;
  chartInstance.data.datasets[0].data = pretaxData;
  chartInstance.data.datasets[1].data = posttaxData;
  chartInstance.data.datasets[2].data = matchData;
  chartInstance.data.datasets[3].data = Array(labels.length).fill(preTaxLimit);
  chartInstance.data.datasets[4].data = Array(labels.length).fill(combinedLimit);

  // Hide post-tax datasets if there is no posttax data
  const hasPostTax = posttaxData.length > 0 && posttaxData.at(-1) > 0;
  chartInstance.data.datasets[1].hidden = !hasPostTax;
  chartInstance.data.datasets[4].hidden = !hasPostTax;

  // Let the chart determine the max y scale
  chartInstance.options.scales.y.max = undefined;

  // Trigger the updates
  chartInstance.update();
}

function exportJson() {
  // Collect the data to save from the HTML
  const data = {};
  $('[data-save]').each(function() {
    data[this.id] = $(this).val();
  });

  // Generate the date stamp (YYYY-MM-DD)
  const now = new Date();
  const dateStamp = now.getFullYear() + '-'
    + String(now.getMonth() + 1).padStart(2, '0') + '-'
    + String(now.getDate()).padStart(2, '0');

  // Serialize the string, turn it into a blob, and make a url pointing to the blob
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  // Create a link that points to our blob
  const link = document.createElement('a');
  link.href = url;
  link.download = `401k-maximizer-${dateStamp}.json`;

  // Append the link to the document, click it, then remove it
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Delay revocation to ensure the browser reads the blob
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function importJson(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = JSON.parse(evt.target.result);

      // Populate the HTML with the data
      Object.keys(data).forEach((key) => {
        if (data[key]) {
          $(`#${key}`).val(data[key]);
        }
      });

      calculateStrategy();
      $('#upload-json').val('');
    } catch (err) {
      console.error('Error parsing file:', err);
      alert('Error parsing file: Invalid file structure or format.');
    }
  };
  reader.readAsText(file);
}
