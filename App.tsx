import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Upload, 
  Wind,
  Layers,
  Activity,
  FileDown,
  Info,
  Settings2
} from 'lucide-react';
import { NormalizationType, RawPoint } from './types';

// 线性拟合工具，用于曲线外推
function linearFit(x: number[], y: number[]) {
  const n = x.length;
  if (n < 2) return { a: 0, b: y[0] || 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i]; sumY += y[i];
    sumXY += x[i] * y[i]; sumXX += x[i] * x[i];
  }
  const a = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const b = (sumY - a * sumX) / n;
  return { a, b };
}

const App: React.FC = () => {
  const [normType, setNormType] = useState<NormalizationType>(NormalizationType.WEIGHTED_GAUSSIAN);
  const [sigmaFactor, setSigmaFactor] = useState(0.8);
  const [spectrum, setSpectrum] = useState<{data: number[][], f: number[], v: number[]} | null>(null);
  const [rawCurves, setRawCurves] = useState<RawPoint[]>([]);
  const [status, setStatus] = useState<string>("等待文件导入");
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 处理能谱导入 (解析 TXT 矩阵)
  const handleSpectrumUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rows = text.trim().split('\n')
        .map(r => r.trim().split(/\s+/).filter(v => v !== "").map(Number))
        .filter(r => r.length > 0);
      
      const numV = rows.length;
      const numF = rows[0].length;
      // 默认范围映射 (可根据需要修改)
      const f_arr = Array.from({length: numF}, (_, i) => 0 + (i/(numF-1)) * 0.8);
      const v_arr = Array.from({length: numV}, (_, i) => 2.5 + (i/(numV-1)) * 2.5);
      
      setSpectrum({ data: rows, f: f_arr, v: v_arr });
      setStatus(`能谱就绪 [${numF}x${numV}]`);
    } catch (err) { setStatus("能谱解析异常"); }
  };

  // 处理曲线导入
  const handleCurveUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const points: RawPoint[] = text.trim().split('\n')
        .map(line => {
          const p = line.trim().split(/\s+/).map(Number);
          return { f: p[0], v: p[1], mode: p[2] || 0 };
        })
        .filter(p => !isNaN(p.f));
      setRawCurves(points);
      setStatus(`曲线就绪 [${points.length} 点]`);
    } catch (err) { setStatus("曲线解析异常"); }
  };

  // 计算带外推的参考路径
  const processedCurves = useMemo(() => {
    if (rawCurves.length === 0 || !spectrum) return [];
    const modes = Array.from(new Set(rawCurves.map(p => p.mode)));
    const f_axis = spectrum.f;

    return modes.map(m => {
      const pts = rawCurves.filter(p => p.mode === m).sort((a, b) => a.f - b.f);
      const mf = pts.map(p => p.f);
      const mv = pts.map(p => p.v);
      const n_trend = Math.min(10, mf.length);
      const leftFit = linearFit(mf.slice(0, n_trend), mv.slice(0, n_trend));
      const rightFit = linearFit(mf.slice(-n_trend), mv.slice(-n_trend));

      return {
        mode: m,
        velocities: f_axis.map(f => {
          if (f < mf[0]) return leftFit.a * f + leftFit.b;
          if (f > mf[mf.length-1]) return rightFit.a * f + rightFit.b;
          // 插值
          const idx = mf.findIndex(rf => rf >= f);
          const f0 = mf[idx-1], f1 = mf[idx], v0 = mv[idx-1], v1 = mv[idx];
          return v0 + (v1 - v0) * (f - f0) / (f1 - f0);
        })
      };
    });
  }, [rawCurves, spectrum]);

  // 渲染归一化后的能谱
  useEffect(() => {
    if (!canvasRef.current || !spectrum) return;
    const ctx = canvasRef.current.getContext('2d')!;
    const { width, height } = canvasRef.current;
    const { data, f: f_axis, v: v_axis } = spectrum;

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, height);

    const fStep = width / f_axis.length;
    const vStep = height / v_axis.length;

    f_axis.forEach((f, i) => {
      // 1. 计算当前频率点的加权窗口 (基于所有 Mode)
      const weights = v_axis.map(v => {
        if (normType === NormalizationType.SIMPLE) return 1.0;
        let maxWeight = 0.02; // 背景噪声底
        processedCurves.forEach(c => {
          const v_ref = c.velocities[i];
          // 动态宽度：w = (start_w - (start_w - end_w) * (f / f_max))
          const w_adaptive = 0.12 - 0.09 * (f / 0.8); 
          const sigma = w_adaptive * sigmaFactor;
          const w = Math.exp(-0.5 * Math.pow((v - v_ref) / sigma, 2));
          maxWeight = Math.max(maxWeight, w);
        });
        return maxWeight;
      });

      // 2. 应用加权并寻找该列最大值
      const weightedCol = v_axis.map((_, j) => data[j][i] * weights[j]);
      const colMax = Math.max(...weightedCol) || 1e-9;

      // 3. 绘制归一化结果 (Jet Colormap)
      v_axis.forEach((_, j) => {
        const val = weightedCol[j] / colMax;
        const r = Math.min(Math.max(Math.min(4 * val - 1.5, -4 * val + 4.5), 0), 1) * 255;
        const g = Math.min(Math.max(Math.min(4 * val - 0.5, -4 * val + 3.5), 0), 1) * 255;
        const b = Math.min(Math.max(Math.min(4 * val + 0.5, -4 * val + 2.5), 0), 1) * 255;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(i * fStep, height - (j + 1) * vStep, fStep + 0.5, vStep + 0.5);
      });
    });

    // 绘制参考曲线（虚线）
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    processedCurves.forEach(c => {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      c.velocities.forEach((v, i) => {
        const x = (i / f_axis.length) * width;
        const y = height - ((v - 2.5) / 2.5) * height;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }, [spectrum, processedCurves, normType, sigmaFactor]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 overflow-hidden">
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-emerald-500" />
          <h1 className="text-lg font-bold tracking-tight">SeisNorm <span className="font-light text-slate-500">v1.5</span></h1>
        </div>
        <div className="flex gap-4 items-center">
          <div className="text-[10px] font-mono bg-black/40 px-3 py-1 rounded-full border border-white/5 text-emerald-400">{status}</div>
          <button className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all">
            <FileDown className="w-4 h-4" /> 导出归一化矩阵
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* 控制面板 */}
        <aside className="w-72 border-r border-slate-800 p-6 space-y-8 bg-slate-900/20">
          <div className="space-y-4">
            <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Upload className="w-3 h-3" /> 数据导入
            </h2>
            <div className="grid gap-2">
              <label className="flex items-center gap-3 p-3 bg-slate-800/50 border border-slate-700 rounded-xl hover:border-emerald-500/50 cursor-pointer transition-all">
                <Wind className="w-4 h-4 text-emerald-400" />
                <span className="text-xs">能谱矩阵 (.txt)</span>
                <input type="file" className="hidden" onChange={handleSpectrumUpload} />
              </label>
              <label className="flex items-center gap-3 p-3 bg-slate-800/50 border border-slate-700 rounded-xl hover:border-amber-400/50 cursor-pointer transition-all">
                <Layers className="w-4 h-4 text-amber-400" />
                <span className="text-xs">拾取点数据 (.txt)</span>
                <input type="file" className="hidden" onChange={handleCurveUpload} />
              </label>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Settings2 className="w-3 h-3" /> 归一化设置
            </h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400">窗口平滑因子 (&sigma;)</p>
                <input 
                  type="range" min="0.1" max="2" step="0.1" 
                  className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                  value={sigmaFactor} 
                  onChange={(e) => setSigmaFactor(parseFloat(e.target.value))}
                />
                <div className="flex justify-between text-[10px] font-mono text-slate-500">
                  <span>窄 (更聚集)</span>
                  <span className="text-emerald-400">{sigmaFactor.toFixed(1)}</span>
                  <span>宽 (更平滑)</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl space-y-2">
            <div className="flex items-center gap-2 text-emerald-400">
              <Info className="w-3 h-3" />
              <span className="text-[10px] font-bold uppercase">科研计算说明</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              系统自动执行一阶线性外推，并应用频率相关的自适应高斯窗：
              <code className="block mt-1 p-1 bg-black/30 rounded text-emerald-300">W(f,v) = exp(-0.5*((v-v_ref)/σ)^2)</code>
            </p>
          </div>
        </aside>

        {/* 预览区域 */}
        <section className="flex-1 p-8 bg-slate-950 flex flex-col gap-6">
          <div className="flex-1 bg-slate-900/30 rounded-3xl border border-slate-800 flex items-center justify-center relative shadow-2xl overflow-hidden">
            {spectrum ? (
              <canvas ref={canvasRef} width={1600} height={1000} className="w-full h-full object-contain p-4" />
            ) : (
              <div className="flex flex-col items-center gap-3 text-slate-600">
                <Activity className="w-12 h-12 opacity-20 animate-pulse" />
                <p className="text-sm font-light italic">请上传数据以进行加权归一化分析</p>
              </div>
            )}
          </div>

          {/* 代码预览 */}
          <div className="h-32 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 font-mono text-[10px] text-slate-500 overflow-y-auto">
            <p className="text-emerald-500 mb-1">// Python 等效实现逻辑</p>
            <pre>{`for i in range(nf):
    v_ref = np.interp(f[i], mf_full, mv_full) # 线性外推
    w_width = (100 - (100-30)*(f[i]/0.8)) * sigma / 1000.0
    weights = np.exp(-0.5 * ((v_axis - v_ref)/w_width)**2)
    im[:, i] = (im[:, i] * weights) / np.max(im[:, i] * weights)`}</pre>
          </div>
        </section>
      </main>
    </div>
  );
};

export default App;
