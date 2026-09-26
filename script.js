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

const MsPerDay = 24 * 60 * 60 * 1000;

let chartInstance = null;

$(document).ready(() => {
  chartInstance = initChart();

  // Add handlers to the save/load buttons
  $('#save-input').on('click', exportJson);
  $('#load-input').on('change', importJson);

  // Add handler to show/hide catch-up fields
  $('#ageBracket').change(function() {
    $('.catchup').toggleClass('d-none', $(this).val() === 'under-50');
  });

  // Add handlers to recalculate when input changes
  $('select, input[type="checkbox"]').on('change', calculate);
  $('input').not('[type="checkbox"]').on('input', calculate);

  // Initial calculation
  calculate();
});

function calculate() {
  const inputs = parseInputs();
  if (!inputs) {
    resetResults();
    return;
  }

  const paycheckCounts = getPaycheckCounts(inputs.firstPaycheckDate, inputs.paycheckDate);
  const strategy = calculateStrategy(inputs, paycheckCounts);
  const paychecks = getPaychecks(inputs, paycheckCounts, strategy);

  renderResults(inputs, paycheckCounts, strategy, paychecks);
}

function parseInputs() {
  const inputs = {
    ageBracket: $('#ageBracket').val(),
    baseElectiveDeferralLimit: parseFloat($('#baseElectiveDeferralLimit').val()) || 0,
    catchUpElectiveDeferralLimit: parseFloat($('#catchUpElectiveDeferralLimit').val()) || 0,
    totalContributionLimit: parseFloat($('#totalContributionLimit').val()) || 0,
    priorYearHighEarner: $('#priorYearHighEarner').is(':checked'),
    companyMatchPct: parseFloat($('#companyMatchPct').val()) || 0,
    firstPaycheckDateStr: $('#firstPaycheckDate').val(),
    paycheckDateStr: $('#paycheckDate').val(),
    paycheckGross: parseFloat($('#paycheckGross').val()) || 0,
    paycheckYtdGross: parseFloat($('#paycheckYtdGross').val()) || 0,
    paycheckYtdPreTaxContrib: parseFloat($('#paycheckYtdPreTaxContrib').val()) || 0,
    paycheckYtdRothContrib: parseFloat($('#paycheckYtdRothContrib').val()) || 0,
    paycheckYtdPostTaxContrib: parseFloat($('#paycheckYtdPostTaxContrib').val()) || 0,
    futurePostTaxContribPct: parseFloat($('#futurePostTaxContribPct').val()) || 0,
  };

  if (!inputs.ageBracket ||
      inputs.baseElectiveDeferralLimit <= 0 ||
      inputs.catchUpElectiveDeferralLimit < 0 ||
      inputs.totalContributionLimit <= 0 ||
      inputs.companyMatchPct < 0 ||
      !inputs.firstPaycheckDateStr ||
      !inputs.paycheckDateStr ||
      inputs.paycheckGross <= 0 ||
      inputs.paycheckYtdGross <= 0 ||
      inputs.paycheckYtdPreTaxContrib < 0 ||
      inputs.paycheckYtdRothContrib < 0 ||
      inputs.paycheckYtdPostTaxContrib < 0 ||
      inputs.futurePostTaxContribPct < 0) {
    return null;
  }

  // Convert the date strings to date objects
  const [y1, m1, d1] = inputs.firstPaycheckDateStr.split('-').map(Number);
  inputs.firstPaycheckDate = new Date(y1, m1 - 1, d1);
  const [y2, m2, d2] = inputs.paycheckDateStr.split('-').map(Number);
  inputs.paycheckDate = new Date(y2, m2 - 1, d2);

  // Compute the max elective deferral limit (base + catch-up elective deferrals)
  inputs.maxElectiveDeferralLimit = inputs.ageBracket === 'under-50'
    ? inputs.baseElectiveDeferralLimit
    : inputs.baseElectiveDeferralLimit + inputs.catchUpElectiveDeferralLimit;

  return inputs;
}

function getPaycheckCounts(firstPaycheckDate, paycheckDate) {
  const currentYear = firstPaycheckDate.getFullYear();
  const nextYearStart = new Date(currentYear + 1, 0, 1);

  // Calculate the current paycheck index (Math.round shields against DST shifts)
  const currentIndex = (Math.round((paycheckDate - firstPaycheckDate) / MsPerDay) / 14);

  // Calculate the total number of paychecks in the year
  let total = Math.ceil(((nextYearStart - firstPaycheckDate) / MsPerDay) / 14);

  // Compute the last pay date
  const finalPayDate = new Date(firstPaycheckDate);
  finalPayDate.setDate(firstPaycheckDate.getDate() + (total * 14));

  // Check if the final pay date would be on New Year's Day of next year
  if (finalPayDate.getFullYear() === currentYear + 1 &&
      finalPayDate.getMonth() === 0 &&
      finalPayDate.getDate() === 1) {
    // Add an extra paycheck because the holiday payday is moved to this year
    total++;
  }

  // Calculate the number of remaining paychecks
  const remaining = total - (currentIndex + 1);

  return { total, remaining, currentIndex };
}

function calculateStrategy(inputs, paycheckCounts) {
  // Compute how much has been contributed and how much remains
  const totalElectiveDeferral = inputs.paycheckYtdPreTaxContrib + inputs.paycheckYtdRothContrib;
  const remainingElectiveDeferral = Math.max(0, inputs.maxElectiveDeferralLimit - totalElectiveDeferral);

  // Check if it's not possible to adjust contributions to maximize deferrals
  if (paycheckCounts.remaining <= 0 || remainingElectiveDeferral <= 0) {
    return { initialPct: 0, futurePct: 0, switchPaycheckIndex: paycheckCounts.currentIndex };
  }

  // Compute the exact target percent to maximize deferrals
  const targetPct = (remainingElectiveDeferral / (paycheckCounts.remaining * inputs.paycheckGross)) * 100;
  if (targetPct > 100) {
    return { initialPct: 100, futurePct: 100, switchPaycheckIndex: paycheckCounts.total };
  }

  const initialPct = Math.ceil(targetPct);
  const futurePct = Math.floor(targetPct);

  // Compute what paycheck to switch from initial to future percent
  const switchPaycheckIndex = paycheckCounts.currentIndex + Math.ceil((targetPct - futurePct) * paycheckCounts.remaining) + 1;

  return { initialPct, futurePct, switchPaycheckIndex };
}

function getPaychecks(inputs, paycheckCounts, strategy) {
  const paychecks = [];
  let runningPreTax = 0;
  let runningRoth = 0;
  let runningCatchUp = 0;
  let runningPostTax = 0;
  let runningMatch = 0;

  const totalElectiveDeferral = inputs.paycheckYtdPreTaxContrib + inputs.paycheckYtdRothContrib;
  const ytdCatchUp = Math.max(0, totalElectiveDeferral - inputs.baseElectiveDeferralLimit);

  // Estimate YTD match
  const approximatePastMatchRate = inputs.paycheckYtdGross > 0 ? Math.min(inputs.companyMatchPct, ((inputs.paycheckYtdPreTaxContrib + inputs.paycheckYtdRothContrib) / inputs.paycheckYtdGross) * 100) : 0;
  const ytdMatch = inputs.paycheckYtdGross * (approximatePastMatchRate / 100);

  for (let i = 0; i < paycheckCounts.total; i++) {
    // Calculate the calendar date for this paycheck
    const payDate = new Date(inputs.firstPaycheckDate);
    payDate.setDate(inputs.firstPaycheckDate.getDate() + (i * 14));
    const payDateStr = payDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    if (i <= paycheckCounts.currentIndex) {
      // Estimate historical paychecks
      const historyWeight = (i + 1) / (paycheckCounts.currentIndex + 1);
      runningPreTax = inputs.paycheckYtdPreTaxContrib * historyWeight;
      runningRoth = inputs.paycheckYtdRothContrib * historyWeight;
      runningCatchUp = ytdCatchUp * historyWeight;
      runningPostTax = inputs.paycheckYtdPostTaxContrib * historyWeight;
      runningMatch = ytdMatch * historyWeight;
    } else {
      //  Project future paychecks
      const currentPct = (i < strategy.switchPaycheckIndex) ? strategy.initialPct : strategy.futurePct;
      const matchPct = Math.min(inputs.companyMatchPct, currentPct);
      const electiveDeferral = inputs.paycheckGross * (currentPct / 100);

      // Calculate the base pre-tax deferral
      const preTaxRoomLeft = Math.max(0, inputs.baseElectiveDeferralLimit - (runningPreTax + runningRoth - runningCatchUp));
      const preTaxDeferral = Math.min(electiveDeferral, preTaxRoomLeft);

      // Calculate the catch-up deferral (if allowed)
      let catchUpDeferral = 0;
      if (inputs.ageBracket !== 'under-50') {
        const catchUpRoomLeft = Math.max(0, inputs.catchUpElectiveDeferralLimit - runningCatchUp);
        const remainingDeferral = Math.max(0, electiveDeferral - preTaxDeferral);
        catchUpDeferral = Math.min(remainingDeferral, catchUpRoomLeft);
      }

      runningPreTax += preTaxDeferral;
      if (inputs.priorYearHighEarner) {
        runningRoth += catchUpDeferral;
      } else {
        runningPreTax += catchUpDeferral;
      }

      runningCatchUp += catchUpDeferral;
      runningPostTax += (inputs.paycheckGross * (inputs.futurePostTaxContribPct / 100));
      runningMatch += (inputs.paycheckGross * (matchPct / 100));
    }

    paychecks.push({
      payDate: payDateStr,
      preTax: runningPreTax,
      roth: runningRoth,
      postTax: runningPostTax,
      match: runningMatch,
      totalCombined: runningPreTax + runningRoth + runningPostTax + runningMatch
    });
  }

  return paychecks;
}

function resetResults() {
  $('#schedule-text').html('<strong>Awaiting Inputs:</strong> Please provide valid input parameters.');
  $('#val-paychecks-current').text('0');
  $('#val-paychecks-total').text('0');
  $('#val-new-pretax-contrib').text('$0.00');
  $('#val-new-posttax-contrib').text('$0.00');
  $('#val-projected-pretax').text('$0.00');
  $('#val-projected-posttax').text('$0.00');
  $('#val-projected-match').text('$0.00');
  $('#val-projected-total').text('$0.00');

  if (chartInstance) {
    chartInstance.data.labels = [];
    chartInstance.data.datasets.forEach(dataset => { dataset.data = []; });
    chartInstance.update();
  }
  return;
}

function renderResults(inputs, paycheckCounts, strategy, paychecks) {
  const lastPaycheck = paychecks[paychecks.length - 1];
  
  // Update Analytics Labels
  $('#val-paychecks-current').text(paycheckCounts.currentIndex + 1);
  $('#val-paychecks-total').text(paycheckCounts.total);
  $('#val-new-pretax-contrib').text('$' + (inputs.paycheckGross * (strategy.initialPct / 100)).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  $('#val-new-posttax-contrib').text('$' + (inputs.paycheckGross * (inputs.futurePostTaxContribPct / 100)).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  $('#val-projected-pretax').text('$' + lastPaycheck.preTax.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  $('#val-projected-roth').text('$' + lastPaycheck.roth.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  $('#val-projected-posttax').text('$' + lastPaycheck.postTax.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  $('#val-projected-match').text('$' + lastPaycheck.match.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  $('#val-projected-total').text('$' + lastPaycheck.totalCombined.toLocaleString(undefined, { maximumFractionDigits: 2 }));

  // Create the schedule bullet list
  const $ul = $('<ul>');
  if (paycheckCounts.remaining == 0) {
    $ul.append($('<li>').html('<strong>No More Paychecks:</strong> There are no more paychecks remaining to try and maximize contributions.'));
  } else if (strategy.initialPct === 0) {
    $ul.append($('<li>').html('<strong>Fully Funded:</strong> Elective deferral limit already reached.'));
  } else if (strategy.initialPct == 100) {
    $ul.append($('<li>').html('<strong>Short-fall:</strong> You will likely not maximize your contributions even if you set your rate to <strong>100%</strong>.'));
  } else {
    // Start with what should be done today
    $ul.append($('<li>').html(`Set rate to <strong>${strategy.initialPct}%</strong> before the next paycheck.`));

    // Add when contributions need to be updated (if needed)
    if (strategy.switchPaycheckIndex < (paycheckCounts.total - 1) &&
        strategy.futurePct >= 0) {
      // Project the target paycheck date to switch contributions
      const targetPaycheckDate = new Date(inputs.firstPaycheckDate.getTime() + strategy.switchPaycheckIndex * 14 * MsPerDay);
      const targetPaycheckDateStr = targetPaycheckDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      // Step back 13 days to find the adjustment reminder date
      const adjustDate = new Date(targetPaycheckDate.getTime() - 13 * MsPerDay);
      const adjustDateStr = adjustDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      $ul.append($('<li>').html(`On <strong>${adjustDateStr}</strong> change your rate to <strong>${strategy.futurePct}%</strong> so it processes in time for your <strong>${targetPaycheckDateStr}</strong> paycheck.`));
    } else {
      $ul.append($('<li>').html('No further changes are needed for the rest of this year.'));
    }
  }

  // Check if any company match will be lost
  if (strategy.initialPct < inputs.companyMatchPct ||
      strategy.futurePct < inputs.companyMatchPct) {
    $ul.append($('<li>')
      .addClass('text-danger')
      .text('Warning: Contribution rate falls below company match rate. You will lose some company match money.'));
  }

  // Check if projected contributions are over the total contribution limit
  if (lastPaycheck.totalCombined > inputs.totalContributionLimit) {
    $ul.append($('<li>')
      .addClass('text-danger')
      .text(`Warning: Total projected contributions ($${lastPaycheck.totalCombined.toLocaleString(undefined, {maximumFractionDigits:0})}) exceed the IRS Combined Annual Limit.`));
  }

  // Add a warning if the limits seem fishy
  const selectedYear = inputs.firstPaycheckDate.getFullYear();
  const irsLimits = IrsLimitsByYear[selectedYear];
  if (irsLimits) {
    // Check if the user's inputs deviate from that year's official IRS defaults
    let expBaseElectiveDeferralLimit = irsLimits.preTax;
    let expCatchUpElectiveDeferralLimit = 0;
    let expContributionLimit = irsLimits.combined;

    // Adjust expected defaults dynamically based on the age bracket choice
    if (inputs.ageBracket === '50-59' || inputs.ageBracket === '64-plus') {
      expCatchUpElectiveDeferralLimit = irsLimits.catchUp;
    } else if (inputs.ageBracket === '60-63') {
      expCatchUpElectiveDeferralLimit = irsLimits.enhancedCatchUp;
    }
    expContributionLimit += expCatchUpElectiveDeferralLimit;

    if (inputs.baseElectiveDeferralLimit !== expBaseElectiveDeferralLimit) {
      $ul.append($('<li>')
        .addClass('text-danger')
        .text(`Warning: Base elective limit $${inputs.baseElectiveDeferralLimit.toLocaleString()} differs from ${selectedYear} IRS defaults ($${expBaseElectiveDeferralLimit.toLocaleString()}).`));
    }
    if (inputs.ageBracket !== 'under-50' && inputs.catchUpElectiveDeferralLimit !== expCatchUpElectiveDeferralLimit) {
      $ul.append($('<li>')
        .addClass('text-danger')
        .text(`Warning: Catch-up elective limit $${inputs.catchUpElectiveDeferralLimit.toLocaleString()} differs from ${selectedYear} IRS defaults ($${expCatchUpElectiveDeferralLimit.toLocaleString()}).`));
    }
    if (inputs.totalContributionLimit !== expContributionLimit) {
      $ul.append($('<li>')
        .addClass('text-danger')
        .text(`Warning: Total contribution limit $${inputs.totalContributionLimit.toLocaleString()} differs from ${selectedYear} IRS defaults ($${expContributionLimit.toLocaleString()}).`));
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

  renderChart(inputs, paycheckCounts, paychecks, strategy);
}

function initChart() {
  // Create the chart
  const ctx = $('#forecastChart')[0].getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Pre-Tax ($)',
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
          label: 'Roth ($)',
          stack: "combined",
          data: [],
          borderColor: '#805ad5',
          backgroundColor: 'rgba(128, 90, 213, 0.15)',
          borderWidth: 3,
          fill: true,
          tension: 0.1,
          pointStyle: 'circle',
          pointBorderWidth: 2,
          pointBackgroundColor: '#805ad5',
          pointBorderColor: '#805ad5'
        },
        {
          label: 'Post-Tax ($)',
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
          label: 'Base Limit',
          stack: 'baseElectiveDeferralLimit',
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
          label: 'Catch-Up Limit',
          stack: 'catchUpElectiveDeferralLimit',
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
          stack: 'totalContributionLimit',
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
}

function renderChart(inputs, paycheckCounts, paychecks, strategy) {
  if (!chartInstance) {
    return;
  }

  // Update our state in the chart for the point color funcs
  chartInstance.options.historyLimit = paycheckCounts.currentIndex;
  chartInstance.options.switchIdx = strategy.switchPaycheckIndex;

  // Set the dataset labels to the pay dates
  chartInstance.data.labels = paychecks.map(p => p.payDate);

  // Update the paycheck datasets
  chartInstance.data.datasets[0].data = paychecks.map(p => p.preTax);
  chartInstance.data.datasets[1].data = paychecks.map(p => p.roth);
  chartInstance.data.datasets[2].data = paychecks.map(p => p.postTax);
  chartInstance.data.datasets[3].data = paychecks.map(p => p.match);

  // Update the limit lines
  const n = paychecks.length;
  chartInstance.data.datasets[4].data = Array(n).fill(inputs.baseElectiveDeferralLimit);
  chartInstance.data.datasets[5].data = Array(n).fill(inputs.maxElectiveDeferralLimit);
  chartInstance.data.datasets[6].data = Array(n).fill(inputs.totalContributionLimit);

  // Hide non-applicable datasets
  const lastPaycheck = paychecks[paychecks.length - 1];
  chartInstance.data.datasets[1].hidden = lastPaycheck.roth === 0;
  chartInstance.data.datasets[2].hidden = lastPaycheck.postTax === 0;
  chartInstance.data.datasets[6].hidden = lastPaycheck.postTax === 0;

  // Update the Y-axis max
  chartInstance.options.scales.y.max = Math.ceil(Math.max(lastPaycheck.totalCombined, inputs.totalContributionLimit));

  // Trigger the updates
  chartInstance.update();
}

function exportJson() {
  const inputs = parseInputs();
  if (!inputs) {
    alert('Cannot export: Please fix input parameters');
    return;
  }

  // Clean-up the input
  inputs.firstPaycheckDate = inputs.firstPaycheckDateStr;
  inputs.paycheckDate = inputs.paycheckDateStr;
  delete inputs.firstPaycheckDateStr;
  delete inputs.paycheckDateStr;
  delete inputs.maxElectiveDeferralLimit;

  // Generate the date stamp (YYYY-MM-DD)
  const now = new Date();
  const dateStamp = now.getFullYear() + '-'
    + String(now.getMonth() + 1).padStart(2, '0') + '-'
    + String(now.getDate()).padStart(2, '0');

  // Serialize the string, turn it into a blob, and make a url pointing to the blob
  const jsonString = JSON.stringify(inputs, null, 2);
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
        const $el = $(`#${key}`);
        if ($el.is(':checkbox')) {
          $el.prop('checked', data[key] === true);
        } else {
          $el.val(data[key]);
        }
      });

      switch (data['ageBracket']) {
        case 'under-50':
          $('.catchup').addClass('d-none');
          break;
        default:
          $('.catchup').removeClass('d-none');
          break;
      }

      calculate();
      $('#load-input').val('');
    } catch (err) {
      console.error('Error parsing file:', err);
      alert('Error parsing file: Invalid file structure or format.');
    }
  };
  reader.readAsText(file);
}
