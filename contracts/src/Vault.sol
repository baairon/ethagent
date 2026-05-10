// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Subset of ERC-8004 the vault proxies. Only setAgentURI is
/// gated on vault-internal authorization; everything else routes around.
interface IERC8004URI {
    function setAgentURI(uint256 agentId, string calldata newURI) external;
}

/// @notice Subset of ERC-721 the vault invokes when handing a token back
/// to its owner. The full ERC-721 surface is intentionally not imported.
interface IERC721SafeTransfer {
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

/// @notice Standard ERC-721 receiver hook so the vault can accept one token
/// via safeTransferFrom and record its depositor as the vault-level owner.
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

/// @title Vault
/// @notice A thin vault that holds one ERC-8004 agent token on behalf of an
/// owner and exposes a least-authority "metadata operator" lane: an
/// authorized operator address can rotate the agent's `agentURI` pointer
/// but cannot transfer the token, touch ENS, or do anything else.
///
/// Properties:
/// - One deployment per agent token. The constructor binds the expected
///   registry and token ID, and every other token is rejected.
/// - The vault has no admin, no upgrade path, no pause, no
///   `selfdestruct`, and no fallback. Once deployed it's immutable.
/// - Owner-only privileges: authorize/revoke metadata operators, unwrap
///   the underlying token. Operators cannot grant rights to other
///   operators or move the token.
/// - Operator-only privilege: rotate the onchain agentURI via
///   `rotateAgentURI`, which proxies to `setAgentURI` on the registry.
contract Vault is IERC721Receiver {
    address private _expectedRegistry;
    uint256 private _expectedAgentId;
    address private _activeRegistry;
    uint256 private _activeAgentId;
    address private _owner;
    uint256 private _authorizationEpoch;

    mapping(address operator => uint256 epoch) private _metadataOperatorEpoch;

    event AgentDeposited(
        address indexed registry,
        uint256 indexed agentId,
        address indexed owner
    );
    event AgentUnwrapped(
        address indexed registry,
        uint256 indexed agentId,
        address indexed recipient
    );
    event MetadataOperatorChanged(
        address indexed registry,
        uint256 indexed agentId,
        address indexed operator,
        bool approved
    );
    event AgentURIRotated(
        address indexed registry,
        uint256 indexed agentId,
        string newURI,
        address indexed signer
    );

    error AlreadyDeposited();
    error UnexpectedToken();
    error NotOwner();
    error NotAuthorized();

    constructor(address registry, uint256 agentId) {
        _expectedRegistry = registry;
        _expectedAgentId = agentId;
    }

    /// @notice Compatibility view for the original per-token ABI. Returns
    /// the depositor only for the active token held by this vault.
    function agentOwner(
        address registry,
        uint256 agentId
    ) public view returns (address) {
        return _matchesActiveToken(registry, agentId) ? _owner : address(0);
    }

    /// @notice Compatibility view for the original per-token ABI. Returns
    /// operator authorization only for the active token held by this vault.
    function metadataOperators(
        address registry,
        uint256 agentId,
        address operator
    ) public view returns (bool) {
        return _matchesActiveToken(registry, agentId)
            && _metadataOperatorEpoch[operator] == _authorizationEpoch;
    }

    /// @notice Current token held by the vault. `owner == address(0)` means
    /// the vault is empty and can accept its configured ERC-8004 token.
    function heldAgent() external view returns (
        address registry,
        uint256 agentId,
        address owner
    ) {
        return (_activeRegistry, _activeAgentId, _owner);
    }

    /// @notice Required by IERC721Receiver. Records the depositor as the
    /// vault-level owner of the one token this vault can hold. `msg.sender`
    /// is the registry contract calling `safeTransferFrom`; trusting it here
    /// is safe because the registry is the only source of truth for who can
    /// invoke this hook with a given `tokenId`.
    function onERC721Received(
        address /* operator */,
        address from,
        uint256 tokenId,
        bytes calldata /* data */
    ) external returns (bytes4) {
        if (msg.sender != _expectedRegistry || tokenId != _expectedAgentId) {
            revert UnexpectedToken();
        }
        if (_owner != address(0)) {
            revert AlreadyDeposited();
        }
        _activeRegistry = msg.sender;
        _activeAgentId = tokenId;
        _owner = from;
        unchecked {
            _authorizationEpoch++;
            if (_authorizationEpoch == 0) _authorizationEpoch = 1;
        }
        emit AgentDeposited(msg.sender, tokenId, from);
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Owner authorizes or revokes a metadata operator for one of
    /// their agents. Reverts unless `msg.sender` is the vault-level
    /// owner of `(registry, agentId)`.
    function setMetadataOperator(
        address registry,
        uint256 agentId,
        address operator,
        bool approved
    ) external {
        if (msg.sender != agentOwner(registry, agentId)) revert NotOwner();
        if (approved) {
            _metadataOperatorEpoch[operator] = _authorizationEpoch;
        } else {
            delete _metadataOperatorEpoch[operator];
        }
        emit MetadataOperatorChanged(registry, agentId, operator, approved);
    }

    /// @notice Owner OR an authorized metadata operator may rotate the
    /// agent's onchain URI. Reverts otherwise.
    function rotateAgentURI(
        address registry,
        uint256 agentId,
        string calldata newURI
    ) external {
        address owner = agentOwner(registry, agentId);
        if (
            msg.sender != owner
            && !metadataOperators(registry, agentId, msg.sender)
        ) {
            revert NotAuthorized();
        }
        IERC8004URI(registry).setAgentURI(agentId, newURI);
        emit AgentURIRotated(registry, agentId, newURI, msg.sender);
    }

    /// @notice Owner takes the underlying ERC-721 token back out of the
    /// vault. Clears the active token record so the same token can be
    /// redeposited later. Operator authorizations are epoch-scoped, so
    /// stale approvals cannot carry into the next deposit.
    function unwrap(
        address registry,
        uint256 agentId,
        address recipient
    ) external {
        address owner = agentOwner(registry, agentId);
        if (msg.sender != owner) revert NotOwner();
        delete _activeRegistry;
        delete _activeAgentId;
        delete _owner;
        IERC721SafeTransfer(registry).safeTransferFrom(
            address(this),
            recipient,
            agentId
        );
        emit AgentUnwrapped(registry, agentId, recipient);
    }

    function _matchesActiveToken(
        address registry,
        uint256 agentId
    ) private view returns (bool) {
        return _owner != address(0)
            && registry == _activeRegistry
            && agentId == _activeAgentId;
    }
}
