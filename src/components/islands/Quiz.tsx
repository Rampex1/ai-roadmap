import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { grade, type Response } from '@/lib/grading';
import { onAnswer } from '@/lib/answers';
import type { PreparedItem } from '@/lib/quiz-data';

const SHOWN = 5;
const html = (h: string) => ({ __html: h });

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Quiz({ items, title = 'Check your understanding' }: { items: PreparedItem[]; title?: string }) {
  const shown = useMemo(() => {
    const all = new URLSearchParams(location.search).get('quiz') === 'all';
    return all ? items : shuffle(items).slice(0, SHOWN);
  }, [items]);
  const titleId = useId();
  return (
    <section className="air-quiz not-content" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      <p className="air-quiz-sub">Answer from memory first — retrieval is what makes it stick.</p>
      {shown.map((it, n) => (
        <QuizItemCard key={it.id} item={it} n={n + 1} />
      ))}
    </section>
  );
}

export function QuizItemCard({ item, n, onGraded }: { item: PreparedItem; n: number; onGraded?: (correct: boolean) => void }) {
  const [resp, setResp] = useState<Response | null>(() => initial(item));
  const [result, setResult] = useState<boolean | null>(null);
  const [live, setLive] = useState('');
  const feedbackRef = useRef<HTMLDivElement>(null);
  const answered = result !== null;
  useEffect(() => {
    if (answered) feedbackRef.current?.focus();
  }, [answered]);

  const check = () => {
    if (!resp) return;
    const ok = grade(item, resp);
    setResult(ok);
    setLive(ok ? 'Correct.' : 'Not quite.');
    onAnswer(item.id, ok);
    onGraded?.(ok);
  };

  const selected = resp?.type === 'mcq' ? [resp.choice] : resp?.type === 'multi' ? resp.choices : [];
  return (
    <fieldset className="air-quiz-item" data-item-id={item.id} data-type={item.type}>
      <legend>
        <span className="air-quiz-num">{n}</span>
        <span dangerouslySetInnerHTML={html(item.promptHtml)} />
      </legend>
      <p className="sr-only" aria-live="polite">{live}</p>
      <Input item={item} resp={resp} setResp={setResp} disabled={answered} announce={setLive} />
      {!answered ? (
        <button type="button" className="air-btn air-btn-primary" onClick={check} disabled={!isAnswerable(resp)}>
          Check answer
        </button>
      ) : (
        <div className={`air-feedback ${result ? 'is-correct' : 'is-wrong'}`} data-feedback data-correct={String(result)} tabIndex={-1} ref={feedbackRef}>
          <p className="air-feedback-head">{result ? 'Correct!' : 'Not quite.'}</p>
          {item.optionsHtml &&
            selected.map((i) => (
              <p key={i} className="air-feedback-why">
                <strong dangerouslySetInnerHTML={html(item.optionsHtml![i].textHtml)} />: <span dangerouslySetInnerHTML={html(item.optionsHtml![i].whyHtml)} />
              </p>
            ))}
          {!result && <CorrectAnswer item={item} />}
          <div className="air-feedback-explain" dangerouslySetInnerHTML={html(item.explanationHtml)} />
        </div>
      )}
    </fieldset>
  );
}

function initial(item: PreparedItem): Response | null {
  if (item.type !== 'order') return null;
  let order = shuffle(item.items);
  if (order.length > 1) while (order.every((t, i) => t === item.items[i])) order = shuffle(item.items);
  return { type: 'order', order };
}

function isAnswerable(r: Response | null): boolean {
  if (!r) return false;
  if (r.type === 'multi') return r.choices.length > 0;
  if (r.type === 'numeric' || r.type === 'cloze' || r.type === 'output') return r.value.trim() !== '';
  return true;
}

function CorrectAnswer({ item }: { item: PreparedItem }) {
  let text: string | null = null;
  if (item.type === 'numeric') text = String(item.answer);
  if (item.type === 'output') text = item.answer;
  if (item.type === 'cloze') text = item.accept?.[0] ?? null;
  if (item.type === 'order')
    return <p className="air-feedback-answer">Correct order: <span dangerouslySetInnerHTML={html(item.itemsHtml!.join(' → '))} /></p>;
  if ((item.type === 'mcq' || item.type === 'multi') && item.optionsHtml) {
    return (
      <>
        {item.options.flatMap((o, i) =>
          o.correct
            ? [<p key={i} className="air-feedback-answer">Correct answer: <strong dangerouslySetInnerHTML={html(item.optionsHtml![i].textHtml)} /> — <span dangerouslySetInnerHTML={html(item.optionsHtml![i].whyHtml)} /></p>]
            : [],
        )}
      </>
    );
  }
  return text ? <p className="air-feedback-answer">Correct answer: <code>{text}</code></p> : null;
}

function Input({ item, resp, setResp, disabled, announce }: { item: PreparedItem; resp: Response | null; setResp: (r: Response) => void; disabled: boolean; announce: (s: string) => void }) {
  const name = `q-${item.id}`;
  switch (item.type) {
    case 'mcq':
    case 'multi': {
      const multi = item.type === 'multi';
      const chosen = resp?.type === 'multi' ? resp.choices : resp?.type === 'mcq' ? [resp.choice] : [];
      return (
        <div className="air-options">
          {item.optionsHtml!.map((o, i) => (
            <label key={i} className={`air-option ${chosen.includes(i) ? 'is-selected' : ''}`}>
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={name}
                disabled={disabled}
                checked={chosen.includes(i)}
                onChange={(e) =>
                  setResp(
                    multi
                      ? { type: 'multi', choices: e.target.checked ? [...chosen, i] : chosen.filter((c) => c !== i) }
                      : { type: 'mcq', choice: i },
                  )
                }
              />
              <span dangerouslySetInnerHTML={html(o.textHtml)} />
            </label>
          ))}
          {multi && <p className="air-hint">Select all that apply.</p>}
        </div>
      );
    }
    case 'numeric':
    case 'cloze':
      return (
        <input
          className="air-text"
          type="text"
          inputMode={item.type === 'numeric' ? 'decimal' : undefined}
          aria-label="Your answer"
          disabled={disabled}
          value={resp && 'value' in resp ? resp.value : ''}
          onChange={(e) => setResp({ type: item.type, value: e.target.value } as Response)}
        />
      );
    case 'output':
      return (
        <>
          <pre className="air-code"><code>{item.code}</code></pre>
          <textarea
            className="air-text"
            rows={3}
            aria-label="Predicted output"
            disabled={disabled}
            value={resp?.type === 'output' ? resp.value : ''}
            onChange={(e) => setResp({ type: 'output', value: e.target.value })}
          />
        </>
      );
    case 'order': {
      const order = resp?.type === 'order' ? resp.order : item.items;
      const htmlOf = (t: string) => item.itemsHtml![item.items.indexOf(t)];
      const plain = (t: string) => t.replace(/\$[^$]*\$/g, '').replace(/[*_`]/g, '').trim() || t;
      const move = (i: number, d: -1 | 1, ev: { currentTarget: HTMLButtonElement }) => {
        const next = [...order];
        [next[i], next[i + d]] = [next[i + d], next[i]];
        setResp({ type: 'order', order: next });
        announce(`${plain(order[i])} moved to position ${i + d + 1} of ${order.length}.`);
        // Keep focus on the moved item: same-direction button if still enabled, else the other one.
        const li = ev.currentTarget.closest('ol');
        const j = i + d;
        requestAnimationFrame(() => {
          const btns = li?.children[j]?.querySelectorAll('button');
          const same = btns?.[d === -1 ? 0 : 1] as HTMLButtonElement | undefined;
          (same && !same.disabled ? same : (btns?.[d === -1 ? 1 : 0] as HTMLButtonElement | undefined))?.focus();
        });
      };
      return (
        <ol className="air-order">
          {order.map((t, i) => (
            <li key={t}>
              <span dangerouslySetInnerHTML={html(htmlOf(t))} />
              <span className="air-order-btns">
                <button type="button" className="air-icon-btn" aria-label={`Move "${plain(t)}" up`} disabled={disabled || i === 0} onClick={(e) => move(i, -1, e)}>↑</button>
                <button type="button" className="air-icon-btn" aria-label={`Move "${plain(t)}" down`} disabled={disabled || i === order.length - 1} onClick={(e) => move(i, 1, e)}>↓</button>
              </span>
            </li>
          ))}
        </ol>
      );
    }
  }
}
