/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion, useInView } from 'motion/react';
import { useRef } from 'react';

interface BlurTextProps {
  text: string;
  delay?: number;
  className?: string;
  animateBy?: 'words' | 'letters';
  direction?: 'top' | 'bottom';
}

export function BlurText({
  text,
  delay = 100,
  className = '',
  animateBy = 'words',
  direction = 'bottom',
}: BlurTextProps) {
  const elements = animateBy === 'words' ? text.split(' ') : text.split('');
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.1 });

  return (
    <span ref={ref} className={`inline-block ${className}`}>
      {elements.map((el, i) => (
        <motion.span
          key={i}
          initial={{ filter: 'blur(10px)', opacity: 0, y: direction === 'bottom' ? 50 : -50 }}
          animate={
            isInView
              ? {
                  filter: ['blur(10px)', 'blur(5px)', 'blur(0px)'],
                  opacity: [0, 0.5, 1],
                  y: [direction === 'bottom' ? 50 : -50, -5, 0],
                }
              : {}
          }
          transition={{
            duration: 0.35 * 3, // Each step is roughly 0.35s if we were using a more granular timeline, but simple transition works too
            delay: (delay / 1000) + i * 0.1,
            ease: "easeOut",
            times: [0, 0.5, 1]
          }}
          style={{ display: 'inline-block', whiteSpace: 'pre' }}
        >
          {el}{animateBy === 'words' && i !== elements.length - 1 ? '\u00A0' : ''}
        </motion.span>
      ))}
    </span>
  );
}
