'use client';

import { useState } from 'react';

interface Props {
  token: string;
  content: string;
  initialLikes: number;
  commentsCount: number;
}

export function ThesisCard({ token, content, initialLikes, commentsCount }: Props) {
  const [liked, setLiked] = useState(false);
  const likes = initialLikes + (liked ? 1 : 0);

  return (
    <section className="rounded-[14px] bg-[#232532] border border-[#3F424D] p-4" title="Derived summary (not on-chain truth)">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-7 h-7 rounded-full bg-[#232532] border border-[#3F424D] flex items-center justify-center text-sm">
          📈
        </span>
        <span className="text-sm font-bold text-[#E9E9ED]">{token}</span>
        <span className="px-2 py-0.5 text-[10px] text-[#E9E9ED] font-semibold bg-[#232532] rounded-full">Thesis</span>
        <span className="px-2 py-0.5 text-[10px] text-[#F0BE67] font-semibold bg-[rgba(240,190,103,0.12)] border border-[#F0BE67]/30 rounded-full">
          Most Liked
        </span>
      </div>
      <blockquote className="mt-3 text-xs text-[#E9E9ED] leading-relaxed italic">“{content}”</blockquote>
      <div className="mt-3 flex items-center gap-4">
        <button
          onClick={() => setLiked((v) => !v)}
          title="Local reaction (not on-chain)"
          className="text-xs font-bold text-[#E9E9ED] hover:text-[#E9E9ED] transition-all scale-100 active:scale-95"
        >
          {liked ? '❤️' : '🤍'} {likes}
        </button>
        <span className="text-xs text-[#9397AB]">🔁 {commentsCount} newer</span>
      </div>
    </section>
  );
}
