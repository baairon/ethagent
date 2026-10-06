import React from 'react'
import { Text } from 'ink'
import { useContentWidth } from './layout.js'
import { wrapWords } from './text.js'

type ParagraphProps = {
  children: string
  color?: string
  bold?: boolean
  width?: number
}

export const Paragraph: React.FC<ParagraphProps> = ({ children, color, bold, width }) => {
  const contentWidth = useContentWidth()
  return <Text color={color} bold={bold}>{wrapWords(children, width ?? contentWidth).join('\n')}</Text>
}
