import React from 'react'
import { Text } from 'ink'
import { eyeGradientColor } from './theme.js'

type GradientTextProps = {
  children: string
  bold?: boolean
}

export const GradientText: React.FC<GradientTextProps> = ({ children, bold }) => {
  const chars = [...children]
  const len = Math.max(chars.length - 1, 1)
  return (
    <Text>
      {chars.map((char, i) => {
        if (!char.trim()) return <Text key={i}>{char}</Text>
        const t = i / len
        return <Text key={i} color={eyeGradientColor(t)} bold={bold}>{char}</Text>
      })}
    </Text>
  )
}
