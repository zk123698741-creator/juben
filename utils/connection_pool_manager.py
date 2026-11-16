"""
🚀 连接池管理器
提供Redis和数据库连接池的统一管理

功能：
1. 分层连接池管理 (高优先级/普通/后台)
2. 连接池健康监控
3. 自动故障恢复
4. 性能统计和诊断
5. 连接池预热功能

"""

import asyncio
import os
import time
from typing import Dict, Any, Optional
from pathlib import Path


class ConnectionPoolManager:
    """
    通用连接池管理器

    功能：
    1. 分层连接池管理
    2. 连接池健康监控
    3. 自动故障恢复
    4. 性能统计
    """

    _instance = None
    _lock = asyncio.Lock()

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if hasattr(self, '_initialized'):
            return

        try:
            from utils.logger import JubenLogger
            self.logger = JubenLogger("ConnectionPoolManager")
        except ImportError:
            import logging
            self.logger = logging.getLogger("ConnectionPoolManager")

        self._initialized = True

        # 连接池实例缓存
        self._redis_pools: Dict[str, Any] = {}
        self._db_clients: Dict[str, Any] = {}

        # 监控统计
        self._connection_stats = {
            'redis_requests': 0,
            'redis_failures': 0,
            'db_requests': 0,
            'db_failures': 0,
            'pool_exhaustions': 0
        }

        # 配置不同用途的连接池大小
        self._pool_configs = {
            'high_priority': {'max_connections': 200, 'timeout': 5},  # 主业务操作
            'normal': {'max_connections': 100, 'timeout': 10},        # 一般操作
            'background': {'max_connections': 50, 'timeout': 15},     # 后台任务
        }

        self.logger.info("🔧 ConnectionPoolManager 初始化完成")
        self.logger.info(f"🔧 连接池配置: {self._pool_configs}")

    async def get_redis_client(self, pool_type: str = 'high_priority'):
        """
        获取Redis客户端，支持不同优先级的连接池

        Args:
            pool_type: 连接池类型 ('high_priority', 'normal', 'background')
        """
        if os.getenv("JUBEN_DESKTOP_DATA") and not os.getenv("REDIS_HOST"):
            return None
        # 先检查连接池是否已存在（无锁检查）
        if pool_type in self._redis_pools:
            self._connection_stats['redis_requests'] += 1
            return self._redis_pools[pool_type]

        # 只有在需要创建连接池时才使用锁
        async with self._lock:
            self._connection_stats['redis_requests'] += 1

            try:
                # 双重检查：防止其他协程在等待锁期间创建了连接池
                if pool_type not in self._redis_pools:
                    self.logger.info(f"🔄 创建新的Redis连接池: {pool_type}")
                    self._redis_pools[pool_type] = await self._create_redis_pool(pool_type)

                return self._redis_pools[pool_type]

            except Exception as e:
                self._connection_stats['redis_failures'] += 1
                self.logger.error(f"❌ 获取Redis客户端失败 (pool_type={pool_type}): {e}")
                # 回退到默认连接池
                try:
                    from utils.redis_client import get_redis_client
                    return await get_redis_client()
                except ImportError:
                    return None

    async def _create_redis_pool(self, pool_type: str):
        """创建指定类型的Redis连接池"""
        from utils.redis_client import JubenRedisClient

        config = self._pool_configs.get(pool_type, self._pool_configs['normal'])

        # 创建自定义Redis客户端
        class CustomRedisClient(JubenRedisClient):
            def __init__(self, pool_type: str, pool_config: dict, logger=None):
                super().__init__()
                self.pool_type = pool_type
                self.pool_config = pool_config
                self._logger = logger
                self._is_connected = False

            async def connect(self) -> bool:
                """重写连接方法，使用自定义连接池配置"""
                if self._is_connected and self._redis:
                    return True

                try:
                    import os

                    redis_host = os.getenv('REDIS_HOST', 'localhost')
                    redis_port = int(os.getenv('REDIS_PORT', 6379))
                    redis_password = os.getenv('REDIS_PASSWORD', '')
                    redis_db = int(os.getenv('REDIS_DB', 0))

                    if redis_password:
                        redis_url = f"redis://:{redis_password}@{redis_host}:{redis_port}/{redis_db}"
                    else:
                        redis_url = f"redis://{redis_host}:{redis_port}/{redis_db}"

                    # 创建连接池
                    try:
                        import redis.asyncio as aioredis
                    except ImportError:
                        import aioredis

                    pool = aioredis.ConnectionPool.from_url(
                        redis_url,
                        max_connections=self.pool_config['max_connections'],
                        retry_on_timeout=True,
                        socket_connect_timeout=self.pool_config['timeout'],
                        socket_timeout=self.pool_config['timeout']
                    )

                    # 使用连接池创建Redis客户端
                    self._redis = aioredis.Redis(
                        connection_pool=pool,
                        encoding="utf-8",
                        decode_responses=True
                    )

                    await self._redis.ping()
                    self._is_connected = True

                    if self._logger:
                        self._logger.info(f"✅ Redis连接池创建成功 (类型={self.pool_type}, 最大连接数={self.pool_config['max_connections']}, 连接超时={self.pool_config['timeout']}s)")
                    return True

                except Exception as e:
                    if self._logger:
                        self._logger.error(f"❌ Redis连接池创建失败 (类型={self.pool_type}): {e}")
                    self._is_connected = False
                    self._redis = None
                    return False

        client = CustomRedisClient(pool_type, config, self.logger)
        if await client.connect():
            return client
        else:
            raise Exception(f"无法创建Redis连接池 (类型={pool_type})")

    async def warmup_pools(self, pool_types: Optional[list] = None):
        """
        预热连接池

        Args:
            pool_types: 要预热的连接池类型列表，默认预热所有类型
        """
        if pool_types is None:
            pool_types = list(self._pool_configs.keys())

        self.logger.info(f"🔥 开始预热连接池: {pool_types}")

        for pool_type in pool_types:
            try:
                await self.get_redis_client(pool_type)
                self.logger.info(f"✅ 连接池预热完成: {pool_type}")
            except Exception as e:
                self.logger.error(f"❌ 连接池预热失败 ({pool_type}): {e}")

    async def health_check(self) -> Dict[str, Any]:
        """
        健康检查

        Returns:
            Dict: 健康状态信息
        """
        health_status = {
            'overall_health': 'healthy',
            'pools': {},
            'stats': self._connection_stats.copy()
        }

        for pool_type, pool in self._redis_pools.items():
            try:
                if hasattr(pool, '_redis') and pool._redis:
                    await pool._redis.ping()
                    health_status['pools'][pool_type] = 'healthy'
                else:
                    health_status['pools'][pool_type] = 'unhealthy'
                    health_status['overall_health'] = 'degraded'
            except Exception as e:
                health_status['pools'][pool_type] = f'unhealthy: {str(e)}'
                health_status['overall_health'] = 'unhealthy'

        return health_status

    def get_stats(self) -> Dict[str, Any]:
        """获取连接统计信息"""
        return self._connection_stats.copy()

    async def close_all(self):
        """关闭所有连接池"""
        self.logger.info("🔄 关闭所有连接池...")

        for pool_type, pool in self._redis_pools.items():
            try:
                if hasattr(pool, '_redis') and pool._redis:
                    await pool._redis.close()
                    self.logger.info(f"✅ 连接池已关闭: {pool_type}")
            except Exception as e:
                self.logger.error(f"❌ 关闭连接池失败 ({pool_type}): {e}")

        self._redis_pools.clear()
        self._db_clients.clear()


# ==================== 全局实例 ====================

_connection_pool_manager: Optional[ConnectionPoolManager] = None


async def get_connection_pool_manager() -> ConnectionPoolManager:
    """获取连接池管理器单例"""
    global _connection_pool_manager
    if _connection_pool_manager is None:
        _connection_pool_manager = ConnectionPoolManager()
    return _connection_pool_manager
