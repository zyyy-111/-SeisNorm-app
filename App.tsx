
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Upload, 
  Settings, 
  Code2, 
  Wind,
  Layers,
  Activity,
  FileDown,
  Info
} from 'lucide-react';
import { NormalizationType, RawPoint } from './types';

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
  const [sigmaFactor, setSigmaFactor] = useState(0.5);
  const [spectrum, setSpectrum] = useState<{data: number[][], f: number[], v: number[]} | null>(null);
  const [rawCurves, setRawCurves] = useState<RawPoint[]>([]);
  const [status, setStatus] = useState<string>("等待导入...");
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleSpectrumUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rows = text.trim().split('\n').map(r => r.trim().split(/\s+/).filter(v => v !== "").map(Number));
      const numV = rows.length;
      const numF = rows[0].length;
      const f_arr = Array.from({length: numF}, (_, i) => 0 + (i/(numF-1)) * 0.8);
      const v_arr = Array.from({length: numV}, (_, i) => 2.5 + (i/(numV-1)) * 2.5);
      setSpectrum({ data: rows, f: f_arr, v: v_arr });
      setStatus(`能谱就绪: ${numF}x${numV}`);
    } catch (err) { setStatus("能谱解析失败"); }
  };

  const handleCurveUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const points: RawPoint[] = text.trim().split('\n').map(line => {
        const p = line.trim().split(/\s+/).filter(v => v !== "").map(Number);
        return { f: p[0], v: p[1], mode: p[2] || 0 };
      });
      setRawCurves(points);
      setStatus(`拾取点就绪: ${points.length} pts`);
    } catch (err) { setStatus("曲线解析失败"); }
  };

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
          const idx = mf.findIndex(rf => rf >= f);
          const f0 = mf[idx-1], f1 = mf[idx], v0 = mv[idx-1], v1 = mv[idx];
          return v0 + (v1 - v0) * (f - f0) / (f1 - f0);
        })
      };
    });
  }, [rawCurves, spectrum]);

  // 下载归一化后的数据
  const handleExport = () => {
    if (!spectrum) return;
    const { data, f: f_axis, v: v_axis } = spectrum;
    let exportText = "";

    f_axis.forEach((f, i) => {
      const col = v_axis.map((v, j) => {
        if (normType === NormalizationType.SIMPLE) return data[j][i];
        let maxW = 0.05;
        processedCurves.forEach(c => {
          const v_ref = c.velocities[i];
          const w_half = (0.1 - 0.07 * (f / 0.8)) * sigmaFactor; 
          const w = Math.exp(-0.5 * Math.pow((v - v_ref) / w_half, 2));
          maxW = Math.max(maxW, w);
        });
        return data[j][i] * maxW;
      });
      const colMax = Math.max(...col) || 1;
      const normalizedCol = col.map(val => (val / colMax).toFixed(6));
      exportText += normalizedCol.join(" ") + "\n";
    });

    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `normalized_spectrum_sigma_${sigmaFactor}.txt`;
    link.click();
    setStatus("矩阵已导出");
  };

  useEffect(() => {
    if (!canvasRef.current || !spectrum) return;
    const ctx = canvasRef.current.getContext('2d')!;
    const { width, height } = canvasRef.current;
    const { data, f: f_axis, v: v_axis } = spectrum;

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, height);

    f_axis.forEach((f, i) => {
      const col = v_axis.map((v, j) => {
        let weight = 1.0;
        if (normType !== NormalizationType.SIMPLE) {
          let maxW = 0.05;
          processedCurves.forEach(c => {
            const v_ref = c.velocities[i];
            const w_half = (0.1 - 0.07 * (f / 0.8)) * sigmaFactor; 
            const w = Math.exp(-0.5 * Math.pow((v - v_ref) / w_half, 2));
            maxW = Math.max(maxW, w);
          });
          weight = maxW;
        }
        return data[j][i] * weight;
      });

      const colMax = Math.max(...col) || 1;

      v_axis.forEach((_, j) => {
        const val = col[j] / colMax;
        const r = Math.min(Math.max(Math.min(4 * val - 1.5, -4 * val + 4.5), 0), 1) * 255;
        const g = Math.min(Math.max(Math.min(4 * val - 0.5, -4 * val + 3.5), 0), 1) * 255;
        const b = Math.min(Math.max(Math.min(4 * val + 0.5, -4 * val + 2.5), 0), 1) * 255;
        
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect((i/f_axis.length)*width, height - (j/v_axis.length)*height, width/f_axis.length+1, height/v_axis.length+1);
      });
    });
  }, [spectrum, processedCurves, normType, sigmaFactor]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 font-sans">
      <header className="flex items-center justify-between px-8 py-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-emerald-400" />
          <h1 className="text-lg font-bold tracking-tight">SeisNorm <span className="text-emerald-600 font-light italic">v1.1</span></h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-3 py-1 bg-black/40 rounded-full border border-white/5 text-[10px] font-mono text-emerald-400">{status}</div>
          <button 
            onClick={handleExport}
            disabled={!spectrum}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-lg shadow-emerald-900/20"
          >
            <FileDown className="w-4 h-4" /> 导出矩阵
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <aside className="w-80 border-r border-slate-800 p-6 flex flex-col gap-8 bg-slate-900/30">
          <div>
            <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">数据源</h2>
            <div className="grid gap-3">
              <label className="flex items-center gap-3 p-3 bg-slate-800 border border-slate-700 rounded-xl hover:border-emerald-500/50 cursor-pointer transition-colors">
                <Wind className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-medium">能谱文件 (.txt)</span>
                <input type="file" className="hidden" onChange={handleSpectrumUpload} />
              </label>
              <label className="flex items-center gap-3 p-3 bg-slate-800 border border-slate-700 rounded-xl hover:border-amber-500/50 cursor-pointer transition-colors">
                <Layers className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-medium">拾取点文件 (.txt)</span>
                <input type="file" className="hidden" onChange={handleCurveUpload} />
              </label>
            </div>
          </div>

          <div>
            <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">算法配置</h2>
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400">归一化模式</p>
                <select 
                  value={normType} 
                  onChange={(e) => setNormType(e.target.value as NormalizationType)}
                  className="w-full bg-slate-800 border border-slate-700 p-2.5 rounded-lg text-xs outline-none focus:ring-1 ring-emerald-500"
                >
                  {Object.values(NormalizationType).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <p className="text-[10px] text-slate-400">加权系数 (&sigma;)</p>
                  <span className="text-xs font-mono text-emerald-400">{sigmaFactor.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0.1" max="2.0" step="0.05" 
                  value={sigmaFactor} 
                  onChange={(e) => setSigmaFactor(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                />
              </div>
            </div>
          </div>

          <div className="mt-auto bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-4">
            <div className="flex gap-2 text-emerald-400 mb-2">
              <Info className="w-4 h-4 shrink-0" />
              <p className="text-[10px] font-bold uppercase">研究员提示</p>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              系统将根据拾取点自动在低频(左)和高频(右)进行线性拟合外推。外推部分的权重窗口将随频率升高自适应收窄，以压制高频混叠噪声。
            </p>
          </div>
        </aside>

        <section className="flex-1 p-8 flex flex-col gap-6 bg-slate-950">
          <div className="flex-1 bg-slate-900/50 rounded-[2rem] border border-slate-800/50 shadow-inner flex items-center justify-center relative overflow-hidden group">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            {spectrum ? (
              <canvas ref={canvasRef} width={1200} height={800} className="w-full h-full object-contain p-4" />
            ) : (
              <div className="flex flex-col items-center gap-4 text-slate-600 animate-pulse">
                <Upload className="w-12 h-12" />
                <p className="text-sm font-light tracking-widest">UPLOAD DATA TO BEGIN ANALYSIS</p>
              </div>
            )}
          </div>

          <div className="h-48 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 font-mono relative overflow-hidden">
            <div className="flex items-center gap-2 text-emerald-500 mb-4 text-[10px] font-bold uppercase tracking-widest">
              <Code2 className="w-4 h-4" /> 导出参考代码 (Python/NumPy)
            </div>
            <div className="text-[11px] leading-relaxed text-slate-500 h-full overflow-y-auto custom-scrollbar">
              <pre>{`# 核心加权逻辑实现
def apply_weighted_norm(S, F, V, curves, sigma=${sigmaFactor}):
    # S: 能谱矩阵 (V, F), F: 频率轴, V: 速度轴
    weights = np.ones_like(S) * 0.05
    for mode_idx, v_path in curves.items():
        for i, f in enumerate(F):
            # 自适应半窗宽 (从 100m/s 到 30m/s 随频率递减)
            w_half = (0.1 - 0.07 * (f / 0.8)) * sigma
            # 计算高斯权重
            weights[:, i] = np.maximum(weights[:, i], 
                             np.exp(-0.5 * ((V - v_path[i]) / w_half)**2))
    
    # 执行每一列的局部极大值归一化
    S_weighted = S * weights
    return S_weighted / np.max(S_weighted, axis=0)`}</pre>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default App;
