import fs from 'fs';

let content = fs.readFileSync('app/descansos/page.tsx', 'utf-8');

const componentCode = `
function DraggableBreakBlock({ b, idx, shift, isMeal, relativeLeft, relativeWidth, handleBreakDragEnd }: any) {
    const [dragOffsetMins, setDragOffsetMins] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    const origStart = new Date(b.start_time).getTime();
    const displayStartMs = origStart + (dragOffsetMins * 60000);
    const displayDate = new Date(displayStartMs);

    return (
        <motion.div
            key={\`plan-\${idx}\`}
            tabIndex={0}
            drag="x"
            dragMomentum={false}
            onDragStart={() => setIsDragging(true)}
            onDrag={(e: any, info: any) => {
                const timelineEl = document.getElementById('timeline-header');
                if (!timelineEl) return;
                const pxPerMinute = timelineEl.getBoundingClientRect().width / (24 * 60);
                setDragOffsetMins(Math.round(info.offset.x / pxPerMinute));
            }}
            onDragEnd={(e: any, info: any) => {
                setIsDragging(false);
                setDragOffsetMins(0);
                handleBreakDragEnd(e, info, shift, idx);
            }}
            className={\`absolute -top-1 -bottom-1 rounded border group/break cursor-pointer transition-transform hover:scale-110 focus:outline-none min-w-[20px] before:absolute before:content-[''] before:-inset-[10px] before:z-[-1] \${isMeal
                ? 'bg-amber-500 border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
                : 'bg-emerald-500 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                } \${isDragging ? 'z-[90] scale-110 opacity-80' : ''}\`}
            style={{
                left: \`\${relativeLeft}%\`,
                width: \`max(\${relativeWidth}%, 20px)\`,
            }}
        >
            <div className={\`absolute -top-12 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[14px] font-bold px-3 py-1.5 rounded whitespace-nowrap shadow-lg pointer-events-none transition-opacity \${isDragging ? 'opacity-100 z-[100]' : 'opacity-0 z-[80] group-hover/break:opacity-100 group-focus/break:opacity-100'}\`}>
                {isMeal ? 'Planned Meal' : 'Planned Break'}<br />
                {displayDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </div>
        </motion.div>
    );
}
`;

content = content + '\n' + componentCode;
fs.writeFileSync('app/descansos/page.tsx', content);
