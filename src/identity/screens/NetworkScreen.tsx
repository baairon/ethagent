import React from 'react'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import type { SelectableNetwork } from '../../storage/config.js'
import { SELECTABLE_NETWORKS } from '../../storage/config.js'
import { currentNetworkLine, networkLabel, networkSubtitle } from '../identityHubModel.js'
import type { EthagentConfig } from '../../storage/config.js'

type NetworkScreenProps = {
  config?: EthagentConfig
  footer: React.ReactNode
  onSelect: (network: SelectableNetwork) => void
  onCancel: () => void
}

export const NetworkScreen: React.FC<NetworkScreenProps> = ({ config, footer, onSelect, onCancel }) => {
  const current = currentNetworkLine(config)
  return (
    <Surface title="network" subtitle={`current: ${current}`} footer={footer}>
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
}
