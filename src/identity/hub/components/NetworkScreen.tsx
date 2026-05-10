import React from 'react'
import { Surface } from '../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../ui/Select.js'
import type { SelectableNetwork } from '../../../storage/config.js'
import { SELECTABLE_NETWORKS } from '../../../storage/config.js'
import { networkLabel, networkSubtitle } from '../model/network.js'

type NetworkScreenProps = {
  subtitle: string
  footer: React.ReactNode
  onSelect: (network: SelectableNetwork) => void
  onCancel: () => void
}

export const NetworkScreen: React.FC<NetworkScreenProps> = ({ subtitle, footer, onSelect, onCancel }) => {
  const options: Array<SelectOption<SelectableNetwork>> = [
    { value: 'mainnet', role: 'section', label: 'High Security' },
    networkOption('mainnet'),
    { value: 'base', role: 'section', label: 'Lower Cost' },
    ...SELECTABLE_NETWORKS.filter(network => network !== 'mainnet').map(networkOption),
  ]

  return (
    <Surface title="Network" subtitle={subtitle} footer={footer}>
      <Select<SelectableNetwork>
        options={options}
        hintLayout="inline"
        onSubmit={onSelect}
        onCancel={onCancel}
      />
    </Surface>
  )
}

function networkOption(network: SelectableNetwork): SelectOption<SelectableNetwork> {
  return {
    value: network,
    label: titleCase(networkLabel(network)),
    hint: networkSubtitle(network),
  }
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, letter => letter.toUpperCase())
}
