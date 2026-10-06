import React from 'react'
import { Surface } from '../../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
import type { SelectableNetwork } from '../../../../storage/config.js'
import { SELECTABLE_NETWORKS } from '../../../../storage/config.js'
import { networkName, networkSubtitle } from '../model/network.js'
import { chainIdForNetwork } from '../../../registry/erc8004.js'

type NetworkScreenProps = {
  title?: string
  subtitle: React.ReactNode
  footer: React.ReactNode
  onSelect: (network: SelectableNetwork) => void
  onCancel: () => void
}

export const NetworkScreen: React.FC<NetworkScreenProps> = ({ title = 'Choose a Network', subtitle, footer, onSelect, onCancel }) => {
  const ordered: SelectableNetwork[] = ['mainnet', ...SELECTABLE_NETWORKS.filter(network => network !== 'mainnet')]
  const options: Array<SelectOption<SelectableNetwork>> = ordered.map(network => ({
    value: network,
    label: networkName(chainIdForNetwork(network)),
    hint: networkSubtitle(network),
  }))

  return (
    <Surface title={title} subtitle={subtitle} footer={footer}>
      <Select<SelectableNetwork>
        options={options}
        hintLayout="inline"
        onSubmit={onSelect}
        onCancel={onCancel}
      />
    </Surface>
  )
}
