import React from 'react'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import type { SelectableNetwork } from '../../storage/config.js'
import { SELECTABLE_NETWORKS } from '../../storage/config.js'
import { networkLabel, networkSubtitle } from '../identityHubModel.js'

type NetworkScreenProps = {
  subtitle: string
  footer: React.ReactNode
  onSelect: (network: SelectableNetwork) => void
  onCancel: () => void
}

export const NetworkScreen: React.FC<NetworkScreenProps> = ({ subtitle, footer, onSelect, onCancel }) => (
  <Surface title="Network" subtitle={subtitle} footer={footer}>
    <Select<SelectableNetwork>
      options={SELECTABLE_NETWORKS.map(network => ({
        value: network,
        label: networkLabel(network),
        hint: networkSubtitle(network),
      }))}
      onSubmit={onSelect}
      onCancel={onCancel}
    />
  </Surface>
)
