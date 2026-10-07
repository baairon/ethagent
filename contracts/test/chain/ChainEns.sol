// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Stand-ins for the ENS contracts, for the local test chain only. The chain suite places
// their runtime code at the real mainnet addresses, so none keeps constructor state, and
// each reaches the others at those fixed addresses. They cover what ethagent and viem
// call: the registry's owner, resolver and subnode writes; the public resolver's text,
// addr, multicall and delegation; and the universal resolver's resolveWithGateways.

address constant ENS_REGISTRY = 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e;

interface IChainEnsRegistry {
    function owner(bytes32 node) external view returns (address);
    function resolver(bytes32 node) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

/// @notice The registry, as ENSRegistry minus the root bootstrap: `testSetOwner` hands
/// out top-level names, which only the test chain can do.
contract ChainEnsRegistry {
    struct Record {
        address owner;
        address resolver;
        uint64 ttl;
    }

    mapping(bytes32 => Record) private _records;
    mapping(address => mapping(address => bool)) private _operators;

    event NewOwner(bytes32 indexed node, bytes32 indexed label, address owner);
    event Transfer(bytes32 indexed node, address owner);
    event NewResolver(bytes32 indexed node, address resolver);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    error NotAuthorized();

    modifier authorised(bytes32 node) {
        address current = _records[node].owner;
        if (current != msg.sender && !_operators[current][msg.sender]) revert NotAuthorized();
        _;
    }

    function testSetOwner(bytes32 node, address newOwner) external {
        _records[node].owner = newOwner;
        emit Transfer(node, newOwner);
    }

    function setOwner(bytes32 node, address newOwner) external authorised(node) {
        _records[node].owner = newOwner;
        emit Transfer(node, newOwner);
    }

    function setSubnodeOwner(bytes32 node, bytes32 label, address newOwner)
        public
        authorised(node)
        returns (bytes32 subnode)
    {
        subnode = keccak256(abi.encodePacked(node, label));
        _records[subnode].owner = newOwner;
        emit NewOwner(node, label, newOwner);
    }

    function setSubnodeRecord(bytes32 node, bytes32 label, address newOwner, address newResolver, uint64 newTtl)
        external
    {
        bytes32 subnode = setSubnodeOwner(node, label, newOwner);
        if (_records[subnode].resolver != newResolver) {
            _records[subnode].resolver = newResolver;
            emit NewResolver(subnode, newResolver);
        }
        _records[subnode].ttl = newTtl;
    }

    function setResolver(bytes32 node, address newResolver) external authorised(node) {
        _records[node].resolver = newResolver;
        emit NewResolver(node, newResolver);
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function owner(bytes32 node) external view returns (address) {
        return _records[node].owner;
    }

    function resolver(bytes32 node) external view returns (address) {
        return _records[node].resolver;
    }

    function ttl(bytes32 node) external view returns (uint64) {
        return _records[node].ttl;
    }

    function recordExists(bytes32 node) external view returns (bool) {
        return _records[node].owner != address(0);
    }

    function isApprovedForAll(address owner_, address operator) external view returns (bool) {
        return _operators[owner_][operator];
    }
}

/// @notice The public resolver: text and addr records, delegation, and multicall, with
/// the registry's owner, its approved operators, or a delegate allowed to write.
contract ChainPublicResolver {
    mapping(bytes32 => mapping(string => string)) private _texts;
    mapping(bytes32 => address) private _addrs;
    mapping(address => mapping(bytes32 => mapping(address => bool))) private _delegates;

    event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value);
    event AddrChanged(bytes32 indexed node, address a);
    event Approved(address owner, bytes32 indexed node, address indexed delegate, bool indexed approved);

    error NotAuthorized();

    modifier authorised(bytes32 node) {
        if (!_isAuthorised(node)) revert NotAuthorized();
        _;
    }

    function setText(bytes32 node, string calldata key, string calldata value) external authorised(node) {
        _texts[node][key] = value;
        emit TextChanged(node, key, key, value);
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _texts[node][key];
    }

    function setAddr(bytes32 node, address a) external authorised(node) {
        _addrs[node] = a;
        emit AddrChanged(node, a);
    }

    function addr(bytes32 node) external view returns (address payable) {
        return payable(_addrs[node]);
    }

    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory) {
        if (coinType != 60 || _addrs[node] == address(0)) return "";
        return abi.encodePacked(_addrs[node]);
    }

    function approve(bytes32 node, address delegate, bool approved) external {
        _delegates[msg.sender][node][delegate] = approved;
        emit Approved(msg.sender, node, delegate, approved);
    }

    function isApprovedFor(address owner, bytes32 node, address delegate) external view returns (bool) {
        return _delegates[owner][node][delegate];
    }

    function multicall(bytes[] calldata data) external returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool ok, bytes memory result) = address(this).delegatecall(data[i]);
            if (!ok) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
            results[i] = result;
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x3b3b57de || interfaceId == 0x59d1d43c
            || interfaceId == 0xf1cb7e06;
    }

    function _isAuthorised(bytes32 node) private view returns (bool) {
        address owner = IChainEnsRegistry(ENS_REGISTRY).owner(node);
        return owner == msg.sender || IChainEnsRegistry(ENS_REGISTRY).isApprovedForAll(owner, msg.sender)
            || _delegates[owner][node][msg.sender];
    }
}

/// @notice The universal resolver viem's getEnsAddress goes through: it hashes the
/// DNS-encoded name, finds its resolver in the registry, and forwards the call.
contract ChainUniversalResolver {
    function resolveWithGateways(bytes calldata name, bytes calldata data, string[] calldata)
        external
        view
        returns (bytes memory result, address resolverAddress)
    {
        bytes32 node = _namehash(name, 0);
        resolverAddress = IChainEnsRegistry(ENS_REGISTRY).resolver(node);
        if (resolverAddress == address(0)) return ("", address(0));
        (bool ok, bytes memory answer) = resolverAddress.staticcall(data);
        if (!ok) return ("", resolverAddress);
        return (answer, resolverAddress);
    }

    function _namehash(bytes calldata name, uint256 offset) private pure returns (bytes32) {
        uint256 length = uint8(name[offset]);
        if (length == 0) return bytes32(0);
        bytes32 label = keccak256(name[offset + 1:offset + 1 + length]);
        return keccak256(abi.encodePacked(_namehash(name, offset + 1 + length), label));
    }
}
