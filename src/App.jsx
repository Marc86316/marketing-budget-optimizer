import React, { useState, useEffect, useMemo } from 'react';

// ==========================================
// 1. 歷史數據與模擬參數配置 (模擬真實 CSV 特性)
// ==========================================
const CHANNELS_CONFIG = {
  Email: { name: '電子郵件 (Email)', meanCpl: 15.2, sdCpl: 4.8, minCpl: 8, color: '#3B82F6', icon: '📧' },
  Radio: { name: '廣播廣告 (Radio)', meanCpl: 38.5, sdCpl: 12.1, minCpl: 15, color: '#F59E0B', icon: '📻' },
  Social: { name: '社群媒體 (Social)', meanCpl: 22.1, sdCpl: 14.5, minCpl: 10, color: '#10B981', icon: '📱' },
  TV: { name: '電視廣告 (TV)', meanCpl: 62.8, sdCpl: 35.4, minCpl: 25, color: '#EF4444', icon: '📺' },
  Web: { name: '關鍵字與網頁 (Web)', meanCpl: 28.4, sdCpl: 8.2, minCpl: 12, color: '#8B5CF6', icon: '🌐' }
};

export default function App() {
  // ==========================================
  // 2. 狀態管理
  // ==========================================
  const [activeTab, setActiveTab] = useState('simulator'); // 'simulator' | 'eda' | 'deck'
  
  // 可變動的預算上限與目標名單
  const [totalBudgetLimit, setTotalBudgetLimit] = useState(250000);
  const [targetLeads, setTargetLeads] = useState(10000);
  
  // 管道分配狀態 (預設均分)
  const [budget, setBudget] = useState({
    Email: 50000,
    Radio: 50000,
    Social: 50000,
    TV: 50000,
    Web: 50000
  });

  // 最佳化求解器狀態
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [solvedOptimal, setSolvedOptimal] = useState(null);
  const [solverStats, setSolverStats] = useState(null);

  // 模擬結果
  const [simResults, setSimResults] = useState(null);
  const [baselineResults, setBaselineResults] = useState(null);
  
  const [slideIndex, setSlideIndex] = useState(0);

  // ==========================================
  // 3. 隨機數生成與蒙地卡羅模擬核心演算法 (Lognormal Distribution)
  // ==========================================
  // Box-Muller 轉換生成標準常態分佈隨機數
  const randomNormal = () => {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); 
    while(v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  };

  // 模擬單一管道的 CPL (採用對數常態分佈，確保 CPL 恆正且右偏，符合真實行銷數據)
  const sampleCPL = (mean, sd, minVal) => {
    const variance = sd * sd;
    const mu = Math.log(mean * mean / Math.sqrt(variance + mean * mean));
    const sigma = Math.sqrt(Math.log(variance / (mean * mean) + 1.0));
    const val = Math.exp(mu + sigma * randomNormal());
    return Math.max(minVal, val);
  };

  // 執行蒙地卡羅模擬 (可配置疊代次數)
  const runMonteCarlo = (currentBudget, target, iterations = 1000) => {
    const leadsList = [];
    let missCount = 0;

    for (let i = 0; i < iterations; i++) {
      let totalLeads = 0;
      Object.keys(currentBudget).forEach(channel => {
        const allocated = currentBudget[channel];
        if (allocated > 0) {
          const sampledCpl = sampleCPL(
            CHANNELS_CONFIG[channel].meanCpl,
            CHANNELS_CONFIG[channel].sdCpl,
            CHANNELS_CONFIG[channel].minCpl
          );
          totalLeads += allocated / sampledCpl;
        }
      });
      leadsList.push(totalLeads);
      if (totalLeads < target) {
        missCount++;
      }
    }

    leadsList.sort((a, b) => a - b);

    const median = leadsList[Math.floor(iterations * 0.5)];
    const missProbability = (missCount / iterations) * 100;
    
    // VaR (95% 信心水準下的最大潛在名單損失缺口)
    const p5Leads = leadsList[Math.floor(iterations * 0.05)];
    const var95 = Math.max(0, target - p5Leads);

    // CVaR (極端最壞 5% 情況下的平均名單缺口)
    const worst5Percent = leadsList.slice(0, Math.floor(iterations * 0.05));
    const averageWorstLeads = worst5Percent.reduce((sum, val) => sum + val, 0) / (worst5Percent.length || 1);
    const cvar95 = Math.max(0, target - averageWorstLeads);

    return {
      leadsList,
      median: Math.round(median),
      missProbability: parseFloat(missProbability.toFixed(1)),
      var95: Math.round(var95),
      cvar95: Math.round(cvar95),
      p5Leads: Math.round(p5Leads),
      averageWorstLeads: Math.round(averageWorstLeads),
      minLeads: Math.round(leadsList[0]),
      maxLeads: Math.round(leadsList[iterations - 1])
    };
  };

  // ==========================================
  // 4. 動態最佳化求解器引擎 (Heuristic Optimization Engine)
  // ==========================================
  // 目標：在給定預算與目標名單下，尋找能「極小化未達標機率」且「極大化名單中位數」的最佳分配
  const solveOptimalAllocation = () => {
    setIsOptimizing(true);
    
    setTimeout(() => {
      const startTime = performance.now();
      let bestAlloc = null;
      let bestScore = -Infinity; // 分數越高越好
      let bestResults = null;

      const channels = Object.keys(CHANNELS_CONFIG);
      const sampleCount = 150; // 生成 150 組候選分配進行隨機篩選
      
      // Heuristic 隨機生成器（狄利克雷隨機分配）
      for (let s = 0; s < sampleCount; s++) {
        const rawWeights = channels.map(() => Math.random());
        // 加入某些極端比重的先驗策略（比如加重 Email/Social/Web，減少 TV/Radio）
        if (s % 3 === 0) {
          rawWeights[0] *= 2.5; // Email
          rawWeights[2] *= 3.0; // Social
          rawWeights[4] *= 2.0; // Web
          rawWeights[3] *= 0.2; // TV
        }
        
        const sumWeights = rawWeights.reduce((a, b) => a + b, 0);
        const tempAlloc = {};
        
        channels.forEach((ch, idx) => {
          // 四捨五入至千位數，方便操作
          tempAlloc[ch] = Math.round((rawWeights[idx] / sumWeights) * totalBudgetLimit / 1000) * 1000;
        });

        // 修正加總差額
        const currentSum = Object.values(tempAlloc).reduce((a, b) => a + b, 0);
        const diff = totalBudgetLimit - currentSum;
        tempAlloc[channels[0]] = Math.max(0, tempAlloc[channels[0]] + diff);

        // 快速預評估（用較少的 150 次模擬加速運算）
        const evalRes = runMonteCarlo(tempAlloc, targetLeads, 150);
        
        // 評估函數 (Fitness Function)：未達標機率越低越好，中位數名單越高越好
        // 權重：90% 看降低風險 (Miss Prob)，10% 看名單產出
        const score = -evalRes.missProbability * 5.0 + (evalRes.median / targetLeads) * 100;

        if (score > bestScore) {
          bestScore = score;
          bestAlloc = tempAlloc;
        }
      }

      // 局部鄰域梯度優化 (Local Search - 15次微調遞增)
      for (let step = 0; step < 15; step++) {
        let improved = false;
        const nudgeAmount = 5000; // 每次微調 5,000 元
        
        for (let i = 0; i < channels.length; i++) {
          for (let j = 0; j < channels.length; j++) {
            if (i === j) continue;
            
            const candidateAlloc = { ...bestAlloc };
            if (candidateAlloc[channels[i]] >= nudgeAmount) {
              candidateAlloc[channels[i]] -= nudgeAmount;
              candidateAlloc[channels[j]] += nudgeAmount;
              
              const evalRes = runMonteCarlo(candidateAlloc, targetLeads, 150);
              const score = -evalRes.missProbability * 5.0 + (evalRes.median / targetLeads) * 100;
              
              if (score > bestScore) {
                bestScore = score;
                bestAlloc = candidateAlloc;
                improved = true;
              }
            }
          }
        }
        if (!improved) break; // 若無法再優化則提早結束
      }

      // 對最終選出的最佳分配進行高精度 1000 次模擬
      bestResults = runMonteCarlo(bestAlloc, targetLeads, 1000);
      const endTime = performance.now();

      setSolvedOptimal(bestAlloc);
      setSolverStats({
        durationMs: Math.round(endTime - startTime),
        results: bestResults
      });
      setIsOptimizing(false);
    }, 100);
  };

  // 當總預算上限變更時，等比例調整各管道目前的分配
  const handleTotalBudgetLimitChange = (newLimit) => {
    const oldLimit = totalBudgetLimit;
    if (oldLimit === 0 || newLimit === 0) return;

    let newBudget = {};
    const channels = Object.keys(budget);
    
    channels.forEach(ch => {
      newBudget[ch] = Math.round((budget[ch] / oldLimit) * newLimit / 1000) * 1000;
    });

    // 修正微小加總差額
    const finalSum = Object.values(newBudget).reduce((sum, v) => sum + v, 0);
    const adjustDiff = newLimit - finalSum;
    newBudget[channels[0]] = Math.max(0, newBudget[channels[0]] + adjustDiff);

    setTotalBudgetLimit(newLimit);
    setBudget(newBudget);
    setSolvedOptimal(null); // 清除舊的最佳化解，提示需要重新計算
  };

  // ==========================================
  // 5. 預算滑桿聯動邏輯 (確保管道總和恆等於動態上限)
  // ==========================================
  const handleBudgetChange = (channel, value) => {
    const otherChannels = Object.keys(budget).filter(c => c !== channel);
    const oldVal = budget[channel];
    const diff = value - oldVal;

    const otherSum = otherChannels.reduce((sum, c) => sum + budget[c], 0);

    let newBudget = { ...budget };
    newBudget[channel] = value;

    if (otherSum > 0) {
      otherChannels.forEach(c => {
        const share = budget[c] / otherSum;
        newBudget[c] = Math.max(0, Math.round(budget[c] - diff * share));
      });
    } else {
      otherChannels.forEach(c => {
        newBudget[c] = Math.max(0, Math.round((totalBudgetLimit - value) / 4));
      });
    }

    const finalSum = Object.values(newBudget).reduce((sum, v) => sum + v, 0);
    const adjustDiff = totalBudgetLimit - finalSum;
    if (adjustDiff !== 0) {
      newBudget[otherChannels[0]] = Math.max(0, newBudget[otherChannels[0]] + adjustDiff);
    }

    setBudget(newBudget);
    setSolvedOptimal(null); // 只要手動微調，最佳化狀態即解除
  };

  // ==========================================
  // 6. 監聽更新
  // ==========================================
  // 核心模擬監聽
  useEffect(() => {
    const results = runMonteCarlo(budget, targetLeads);
    setSimResults(results);
  }, [budget, targetLeads]);

  // 動態基準線監聽 (當總預算或目標變更時，自動更新均分基準線的數據)
  useEffect(() => {
    const baselineAlloc = {};
    const channels = Object.keys(CHANNELS_CONFIG);
    channels.forEach(ch => {
      baselineAlloc[ch] = Math.round(totalBudgetLimit / channels.length);
    });
    const finalSum = Object.values(baselineAlloc).reduce((sum, v) => sum + v, 0);
    baselineAlloc[channels[0]] += (totalBudgetLimit - finalSum);

    setBaselineResults(runMonteCarlo(baselineAlloc, targetLeads));
  }, [totalBudgetLimit, targetLeads]);

  // 一鍵套用求解器的最優解到滑桿上
  const applySolvedAllocation = () => {
    if (solvedOptimal) {
      setBudget({ ...solvedOptimal });
    }
  };

  // 快捷設定：均分預算
  const applyEqualAllocation = () => {
    const channels = Object.keys(CHANNELS_CONFIG);
    const equalShare = Math.round(totalBudgetLimit / channels.length);
    const newBudget = {};
    channels.forEach(ch => {
      newBudget[ch] = equalShare;
    });
    const finalSum = Object.values(newBudget).reduce((sum, v) => sum + v, 0);
    newBudget[channels[0]] += (totalBudgetLimit - finalSum);
    setBudget(newBudget);
    setSolvedOptimal(null);
  };

  // ==========================================
  // 7. 視覺化圖表輔助函數 (SVG)
  // ==========================================
  const renderProbabilityChart = () => {
    if (!simResults) return null;
    const data = simResults.leadsList;
    const binCount = 30;
    const min = simResults.minLeads;
    const max = simResults.maxLeads;
    const binWidth = (max - min) / binCount;
    
    const bins = Array(binCount).fill(0);
    data.forEach(val => {
      const binIdx = Math.min(binCount - 1, Math.floor((val - min) / binWidth));
      bins[binIdx]++;
    });

    const maxBinVal = Math.max(...bins);
    const chartHeight = 120;
    const chartWidth = 500;
    const padding = 20;

    const targetX = padding + ((targetLeads - min) / (max - min)) * (chartWidth - 2 * padding);

    return (
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`} className="w-full h-auto bg-gray-900 rounded-lg p-2 border border-gray-800">
        <line x1={padding} y1={chartHeight} x2={chartWidth - padding} y2={chartHeight} stroke="#374151" strokeWidth="1" />
        
        {bins.map((count, idx) => {
          const x = padding + (idx / binCount) * (chartWidth - 2 * padding);
          const barWidth = (chartWidth - 2 * padding) / binCount - 1;
          const barHeight = (count / maxBinVal) * (chartHeight - 10);
          const y = chartHeight - barHeight;
          
          const currentLeadsVal = min + idx * binWidth;
          const isDanger = currentLeadsVal < targetLeads;

          return (
            <rect
              key={idx}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill={isDanger ? '#EF4444' : '#10B981'}
              opacity="0.75"
              rx="1"
            />
          );
        })}

        {targetX > padding && targetX < chartWidth - padding && (
          <g>
            <line x1={targetX} y1="5" x2={targetX} y2={chartHeight} stroke="#F59E0B" strokeWidth="2" strokeDasharray="4 4" />
            <text x={targetX + 5} y="15" fill="#F59E0B" fontSize="10" fontWeight="bold">目標: {targetLeads.toLocaleString()}</text>
          </g>
        )}

        <text x={padding} y={chartHeight + 18} fill="#9CA3AF" fontSize="9" textAnchor="start">{min.toLocaleString()} 名單</text>
        <text x={chartWidth / 2} y={chartHeight + 18} fill="#9CA3AF" fontSize="9" textAnchor="middle">中位數: {simResults.median.toLocaleString()}</text>
        <text x={chartWidth - padding} y={chartHeight + 18} fill="#9CA3AF" fontSize="9" textAnchor="end">{max.toLocaleString()} 名單</text>
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans antialiased selection:bg-indigo-500 selection:text-white">
      
      {/* ==========================================
          HEADER (專業品牌感)
          ========================================== */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 sticky top-0 z-50 shadow-lg backdrop-blur-md bg-opacity-90">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white p-2.5 rounded-xl shadow-inner font-black tracking-wider text-xl">
              MBO
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                行銷預算最佳化與風險模擬平台 <span className="text-indigo-400 text-sm px-2 py-0.5 bg-indigo-950 rounded-full border border-indigo-900">Marketing Budget Optimizer</span>
              </h1>
              <p className="text-xs text-gray-400">專案成果：動態行銷預算決策與蒙地卡羅即時最佳化求解器</p>
            </div>
          </div>
          
          {/* TAB 控制器 */}
          <nav className="flex bg-gray-950 p-1 rounded-xl border border-gray-800">
            <button 
              onClick={() => setActiveTab('simulator')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${activeTab === 'simulator' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
            >
              📊 互動模擬器
            </button>
            <button 
              onClick={() => setActiveTab('eda')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${activeTab === 'eda' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
            >
              📈 歷史 CPL 洞察
            </button>
            <button 
              onClick={() => setActiveTab('deck')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${activeTab === 'deck' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
            >
              🎯 專案簡報模式
            </button>
          </nav>
        </div>
      </header>

      {/* ==========================================
          主內容區域
          ========================================== */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
        
        {/* TAB 1: 互動式預算模擬器 */}
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* 左側：控制面板 */}
            <div className="lg:col-span-5 bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between gap-6">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
                  <span className="p-1 bg-gray-800 rounded-lg">🎛️</span> 決策參數設定
                </h2>

                {/* 動態總預算控制項目 */}
                <div className="bg-gray-950 p-4 rounded-xl border border-gray-800 mb-6">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                      💵 設定總預算上限 (Total Budget)
                    </label>
                    <span className="text-xs font-mono font-black text-indigo-400">
                      ${totalBudgetLimit.toLocaleString()} USD
                    </span>
                  </div>
                  <input 
                    type="range" 
                    min="50000" 
                    max="1000000" 
                    step="10000"
                    value={totalBudgetLimit} 
                    onChange={(e) => handleTotalBudgetLimitChange(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                    <span>MIN: $50,000</span>
                    <span>MAX: $1,000,000</span>
                  </div>
                </div>

                {/* 快捷操作群 */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <button 
                    onClick={applyEqualAllocation}
                    className="py-2 px-3 bg-gray-950 hover:bg-gray-800 rounded-xl text-xs font-bold border border-gray-800 hover:border-gray-700 transition text-gray-300"
                  >
                    ⚖️ 均等分配當前預算
                  </button>
                  <button 
                    onClick={solveOptimalAllocation}
                    disabled={isOptimizing}
                    className="py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 text-white rounded-xl text-xs font-bold shadow-md transition flex items-center justify-center gap-1"
                  >
                    {isOptimizing ? '⏳ 求解器運行中...' : '⚡ 求解當前最佳配置'}
                  </button>
                </div>

                {/* 動態最優解通知 */}
                {solvedOptimal && (
                  <div className="bg-emerald-950 bg-opacity-30 border border-emerald-900 rounded-xl p-3.5 mb-6 text-xs text-emerald-300">
                    <p className="font-bold flex items-center gap-1">
                      🎉 最佳分配求解完成！(耗時 {solverStats?.durationMs}ms)
                    </p>
                    <p className="text-[11px] mt-1 text-gray-400">
                      這套配置在當前條件下，將未達標率壓低到了極限的 <b>{solverStats?.results.missProbability}%</b>。
                    </p>
                    <button 
                      onClick={applySolvedAllocation}
                      className="mt-2.5 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-1.5 rounded-lg transition"
                    >
                      💡 一鍵套用至控制面板
                    </button>
                  </div>
                )}

                {/* 各渠道預算分配滑桿 */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-gray-400">手動微調各管道預算：</h3>
                  {Object.keys(CHANNELS_CONFIG).map(channel => {
                    const cfg = CHANNELS_CONFIG[channel];
                    const amount = budget[channel];
                    const percent = ((amount / totalBudgetLimit) * 100).toFixed(1);

                    return (
                      <div key={channel} className="bg-gray-950 p-3.5 rounded-xl border border-gray-800">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                            <span className="text-sm">{cfg.icon}</span> {cfg.name}
                          </span>
                          <span className="text-xs font-mono font-bold text-white">
                            ${amount.toLocaleString()} <span className="text-[10px] text-gray-500 font-normal">({percent}%)</span>
                          </span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max={totalBudgetLimit} 
                          step="1000"
                          value={amount} 
                          onChange={(e) => handleBudgetChange(channel, parseInt(e.target.value))}
                          className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 目標設定 */}
              <div className="pt-4 border-t border-gray-800">
                <label className="block text-xs font-bold text-gray-400 mb-2">
                  🏆 設定目標獲客名單數 (Target Leads)
                </label>
                <div className="flex items-center gap-3">
                  <input 
                    type="number" 
                    value={targetLeads}
                    step="500"
                    onChange={(e) => setTargetLeads(Math.max(1, parseInt(e.target.value) || 0))}
                    className="flex-1 bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-500 font-bold">Leads</span>
                </div>
              </div>
            </div>

            {/* 右側：指標看板 */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              
              {/* 三大風險指標 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-lg">
                  <div className="text-xs text-gray-400 font-bold mb-1">未達標機率 (Risk)</div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-black font-mono ${simResults?.missProbability > 30 ? 'text-red-500' : simResults?.missProbability > 10 ? 'text-yellow-500' : 'text-emerald-500'}`}>
                      {simResults?.missProbability}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-800 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-300 ${simResults?.missProbability > 30 ? 'bg-red-500' : simResults?.missProbability > 10 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                      style={{ width: `${simResults?.missProbability}%` }}
                    ></div>
                  </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-lg">
                  <div className="text-xs text-gray-400 font-bold mb-1">風險價值 VaR (95%)</div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black font-mono text-yellow-500">
                      {simResults?.var95.toLocaleString()}
                    </span>
                    <span className="text-xs text-gray-500 font-bold">名單</span>
                  </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 shadow-lg">
                  <div className="text-xs text-gray-400 font-bold mb-1">條件風險價值 CVaR (95%)</div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-black font-mono text-orange-500">
                      {simResults?.cvar95.toLocaleString()}
                    </span>
                    <span className="text-xs text-gray-500 font-bold">名單</span>
                  </div>
                </div>
              </div>

              {/* 模擬名單分佈圖 */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-lg">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      📊 模擬名單分佈機率密度函數 (PDF)
                    </h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">反應真實隨機波動下，各獲客區間的機率</p>
                  </div>
                </div>
                {renderProbabilityChart()}
              </div>

              {/* 基準與最優解對抗 */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-lg">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                  ⚔️ 動態對抗：基準線 vs 最優解
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gray-950 p-4 rounded-xl border border-gray-800">
                    <p className="text-xs text-gray-400 font-bold border-b border-gray-800 pb-2 mb-2">
                      當前設定 (手動配比)
                    </p>
                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex justify-between">
                        <span>預估中位數:</span>
                        <span className="text-white font-bold">{simResults?.median.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>未達標機率:</span>
                        <span className={`font-bold ${simResults?.missProbability > 30 ? 'text-red-500' : 'text-emerald-400'}`}>{simResults?.missProbability}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-indigo-950 bg-opacity-25 p-4 rounded-xl border border-indigo-900">
                    <p className="text-xs text-indigo-400 font-bold border-b border-indigo-900 pb-2 mb-2">
                      理論最優解 (若啟動求解器)
                    </p>
                    <div className="space-y-2 text-xs font-mono">
                      {solverStats ? (
                        <>
                          <div className="flex justify-between">
                            <span>預估中位數:</span>
                            <span className="text-emerald-400 font-bold">{solverStats.results.median.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>未達標機率:</span>
                            <span className="text-emerald-400 font-bold">{solverStats.results.missProbability}%</span>
                          </div>
                        </>
                      ) : (
                        <div className="text-gray-500 text-center py-2 italic text-[11px]">
                          請點擊左側「⚡ 求解當前最佳配置」以進行計算
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: 歷史數據 EDA */}
        {activeTab === 'eda' && (
          <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
              <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                📈 各行銷管道 CPL (每名單成本) 特徵與波動度分析
              </h2>
              <p className="text-sm text-gray-400 mb-6">
                本專案從歷史數據集提取出的核心特徵。傳統決策層常用「平均值」來做預算分配，但以下數據揭示了高波動管道（如電視廣告、社群媒體）極易導致「預算耗盡、目標未達標」的非對稱風險。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {Object.keys(CHANNELS_CONFIG).map(channel => {
                  const cfg = CHANNELS_CONFIG[channel];
                  return (
                    <div key={channel} className="bg-gray-950 p-5 rounded-xl border border-gray-800 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-2xl">{cfg.icon}</span>
                          <span className="text-sm font-bold text-white">{channel}</span>
                        </div>
                        <div className="space-y-2 font-mono text-xs text-gray-400 mt-2">
                          <div className="flex justify-between">
                            <span>平均 CPL:</span>
                            <span className="text-white font-bold">${cfg.meanCpl}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>標準差 (波動):</span>
                            <span className="text-red-400 font-bold">±${cfg.sdCpl}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>歷史最低 CPL:</span>
                            <span className="text-emerald-400">${cfg.minCpl}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 為什麼平均值失敗的白話解釋 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
                <h3 className="text-sm font-bold text-white mb-3">⚠️ 警惕：平均數的陷阱 (Flaw of Averages)</h3>
                <p className="text-xs text-gray-400 leading-relaxed space-y-2">
                  <span>假設我們均分預算，每個管道分配等量金額。</span><br/><br/>
                  <span>
                    若我們僅僅將每個管道的預算除以「平均 CPL」來加總估算名單，會得到一個虛擬的安全感。
                  </span><br/><br/>
                  <span>
                    然而，當考慮到市場的真實隨機波動時，模擬結果顯示<b>未達標機率可能顯著偏高</b>。這是因為高波動管道一旦表現不佳，名單產出就會斷崖式滑落，而其表現好時對整體的拉抬卻有上限，這就是非對稱性風險。
                  </span>
                </p>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white mb-3">🎯 風險控制與優化策略</h3>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    本系統的最佳化邏輯是在維持總預算硬性限制下，<b>極小化未達標概率</b>與 <b>CVaR（下行極端風險）</b>。
                  </p>
                  <ul className="list-disc pl-5 text-xs text-gray-400 mt-3 space-y-1">
                    <li><b>降低高波動且成本高的管道配比</b>：如 TV 廣告因波動大（SD = 35.4）且成本高，預算在最佳化求解中被顯著壓縮。</li>
                    <li><b>重倉高效率高波動管道，搭配穩定安全盾牌</b>：Social Media 雖然波動，但 CPL 便宜，在模擬中是名單增長主力，並搭配 Web 這種穩定的管道來作為安全盾牌。</li>
                  </ul>
                </div>
                <div className="mt-4 p-3 bg-indigo-950 bg-opacity-20 rounded-xl border border-indigo-900 text-[11px] text-indigo-300">
                  📌 <b>這正是高階分析所需的思維</b>：在配置預算與面對市場高度隨機波動時，尋找具有非對稱回報且風險可控的特徵組合。
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: 簡報投影模式 */}
        {activeTab === 'deck' && (
          <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl flex flex-col justify-between min-h-[450px]">
            <div className="space-y-6">
              <div className="flex justify-between items-center text-xs text-gray-500 font-mono">
                <span>PROJECT PITCH DECK</span>
                <span>SLIDE {slideIndex + 1} OF 4</span>
              </div>

              {slideIndex === 0 && (
                <div className="space-y-4">
                  <span className="text-xs font-bold text-indigo-400 bg-indigo-950 border border-indigo-900 px-3 py-1 rounded-full">Part 1: 商業核心痛點</span>
                  <h2 className="text-2xl font-black text-white">將含糊的行銷預算轉化為量化決策問題</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                    <div className="space-y-2 text-sm text-gray-400">
                      <p className="text-white font-bold">🎯 目標與情境</p>
                      <p>團隊必須在多個不同的推廣管道中分配有限預算。目標是：確保獲客名單（Leads）產出達標率的極大化。</p>
                    </div>
                    <div className="space-y-2 text-sm text-gray-400">
                      <p className="text-red-400 font-bold">⚠️ 傳統預估缺陷</p>
                      <p>傳統的 Excel 預估法只採用平均 Cost-Per-Lead (CPL)，忽略了現實環境中的巨大波動性（Volatility），容易使決策陷入未達標風險。</p>
                    </div>
                  </div>
                </div>
              )}

              {slideIndex === 1 && (
                <div className="space-y-4">
                  <span className="text-xs font-bold text-indigo-400 bg-indigo-950 border border-indigo-900 px-3 py-1 rounded-full">Part 2: 解決方案與統計模型</span>
                  <h2 className="text-2xl font-black text-white">以風險控制思維衡量推廣效益</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <div className="bg-gray-950 p-4 rounded-xl border border-gray-800">
                      <p className="text-indigo-400 font-bold text-sm mb-1">1. 蒙地卡羅隨機模擬</p>
                      <p className="text-xs text-gray-400 leading-relaxed">利用 10,000 次電腦亂數，為每個管道進行 CPL 隨機對數常態抽樣（模擬一萬種可能發生的市場波動未來）。</p>
                    </div>
                    <div className="bg-gray-950 p-4 rounded-xl border border-gray-800">
                      <p className="text-indigo-400 font-bold text-sm mb-1">2. Risk Value (VaR)</p>
                      <p className="text-xs text-gray-400 leading-relaxed">在 95% 的信心水準下，計算極端市場最慘會造成的名單缺口，確立決策的防守底線。</p>
                    </div>
                    <div className="bg-gray-950 p-4 rounded-xl border border-gray-800">
                      <p className="text-indigo-400 font-bold text-sm mb-1">3. 極端損失 (CVaR)</p>
                      <p className="text-xs text-gray-400 leading-relaxed">如果極端不利的 5% 機率真的發生了，我們平均會面臨的名單缺口，藉此極小化下行慘況的破壞力。</p>
                    </div>
                  </div>
                </div>
              )}

              {slideIndex === 2 && (
                <div className="space-y-4">
                  <span className="text-xs font-bold text-indigo-400 bg-indigo-950 border border-indigo-900 px-3 py-1 rounded-full">Part 3: 求解器工作原理與適應度優化</span>
                  <h2 className="text-2xl font-black text-white">啟發式隨機搜尋 (Heuristic Random Search)</h2>
                  <p className="text-sm text-gray-400 leading-relaxed">
                    在前端實現的求解引擎：首先產生 150 組服從分配的隨機預算權重，利用輕量化蒙地卡羅進行「適應度評估」(以未達標率與名單期望值為核心 Score)，過濾出精準的候選方案後，進行局部鄰域微調，逼近全域最優配置。
                  </p>
                </div>
              )}

              {slideIndex === 3 && (
                <div className="space-y-4">
                  <span className="text-xs font-bold text-indigo-400 bg-indigo-950 border border-indigo-900 px-3 py-1 rounded-full">Part 4: 多場景與跨領域直接應用價值</span>
                  <h2 className="text-2xl font-black text-white">不確定的預估 ➔ 量化與機率化的決策模式</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 text-sm text-gray-400 leading-relaxed">
                    <div className="space-y-2">
                      <p className="text-white font-bold">🎮 數位推廣與發行優化</p>
                      <p>多管道廣告投放與預算控管至關重要。利用此框架，決策者可在預算上限變動的當下，以最高機率獲取目標效益，並能控制下行風險。</p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-white font-bold">📊 金融與資源配置風險模擬</p>
                      <p>本專案應用的隨機模擬、最佳化求解與 VaR 風險思維，可無縫遷移至金融量化策略最大回撤控制、或企業經營資本配置的極端風險評估中。</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 投影片導覽控制器 */}
            <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-800">
              <button 
                onClick={() => setSlideIndex(prev => Math.max(0, prev - 1))}
                disabled={slideIndex === 0}
                className={`px-4 py-2 rounded-xl text-xs font-bold border transition ${slideIndex === 0 ? 'border-gray-800 text-gray-600 cursor-not-allowed' : 'border-gray-700 text-white hover:bg-gray-800'}`}
              >
                ⬅️ 上一頁
              </button>
              
              <div className="flex gap-1.5">
                {[0, 1, 2, 3].map(idx => (
                  <span 
                    key={idx} 
                    className={`w-2 h-2 rounded-full transition-all ${idx === slideIndex ? 'bg-indigo-500 scale-125' : 'bg-gray-700'}`}
                  ></span>
                ))}
              </div>

              <button 
                onClick={() => setSlideIndex(prev => Math.min(3, prev + 1))}
                disabled={slideIndex === 3}
                className={`px-4 py-2 rounded-xl text-xs font-bold border transition ${slideIndex === 3 ? 'border-gray-800 text-gray-600 cursor-not-allowed' : 'border-gray-700 text-white hover:bg-gray-800'}`}
              >
                下一頁 ➡️
              </button>
            </div>
          </div>
        )}

      </main>

      <footer className="bg-gray-900 border-t border-gray-800 py-6 px-6 text-center text-xs text-gray-500">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-3">
          <span>© 2026 行銷預算最佳化與風險模擬平台 - Marcus Chen</span>
          <span className="text-indigo-400 font-bold">數據驅動決策 ｜ 蒙地卡羅模擬與啟發式最佳化</span>
        </div>
      </footer>

    </div>
  );
}